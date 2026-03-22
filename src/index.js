#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const boxen = require('boxen');
const inquirer = require('inquirer');
const lark = require('@larksuiteoapi/node-sdk');

const { getWorkspace } = require('./lib/workspace');
const { createLarkClient, startWS } = require('./lib/feishu');
const CommandRegistry = require('./lib/commands');
const SecurityManager = require('./lib/security');
const OpenCodeBridge = require('./lib/opencode');
const CardManager = require('./lib/cards');
const StorageManager = require('./lib/storage');

const ws = getWorkspace();
const pidFile = path.join(ws.root, 'oc-channels.pid');
const logFile = path.join(ws.logs, 'out.log');
const errorLogFile = path.join(ws.logs, 'error.log');

const program = new Command();

program
    .name('oc-channels')
    .description('OpenCode Channels Gateway')
    .version('1.1.4');

async function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

async function runServer() {
    const securityManager = new SecurityManager(ws.config, ws.storage);
    const config = securityManager.getConfig();
    
    if (!config.feishu.appId || !config.feishu.appSecret) {
        console.error(chalk.red('配置不完整，请先运行: oc-channels setup'));
        process.exit(1);
    }

    const opencodePort = await findFreePort();
    let opencodeProcess = null;

    async function startOpencodeEngine(cwd) {
        if (opencodeProcess) {
            console.log(chalk.yellow(`[OPCODE] Stopping existing opencode process (PID: ${opencodeProcess.pid})...`));
            opencodeProcess.kill('SIGTERM');
            await new Promise(r => setTimeout(r, 1000));
        }

        console.log(chalk.cyan(`[OPCODE] Starting opencode on port ${opencodePort} in ${cwd}...`));
        opencodeProcess = spawn('opencode', ['serve', '--port', opencodePort.toString(), '--hostname', '127.0.0.1', '--print-logs'], {
            cwd,
            stdio: 'pipe'
        });

        fs.writeFileSync(ws.engine, JSON.stringify({
            pid: opencodeProcess.pid,
            port: opencodePort,
            startedAt: new Date().toISOString(),
            workspace: cwd
        }, null, 2));

        opencodeProcess.stdout.on('data', (data) => {
            console.log(`[OPCODE STDOUT] ${data}`);
        });

        opencodeProcess.stderr.on('data', (data) => {
            console.error(`[OPCODE STDERR] ${data}`);
        });

        opencodeProcess.on('exit', (code) => {
            console.log(chalk.yellow(`[OPCODE] Process exited with code ${code}`));
            try {
                if (fs.existsSync(ws.engine)) {
                    const engineInfo = JSON.parse(fs.readFileSync(ws.engine, 'utf8'));
                    if (engineInfo.pid === opencodeProcess.pid) {
                        fs.unlinkSync(ws.engine);
                    }
                }
            } catch (e) {}
        });

        await new Promise(r => setTimeout(r, 2000));
    }

    await startOpencodeEngine(config.workspace || process.cwd());

    const commandRegistry = new CommandRegistry(ws.scripts);
    await commandRegistry.init();

    commandRegistry.registerBuiltIn('workspace', '切换 OpenCode 工作区目录', async (ctx, args) => {
        if (args.length === 0) {
            await ctx.replyCard(CardManager.createServiceCard('⚠️ 提示', '请提供目录路径，例如: #workspace ~/projects/my-app', 'warning'));
            return;
        }
        let targetPath = args.join(' ');
        if (targetPath.startsWith('~')) {
            targetPath = path.join(os.homedir(), targetPath.slice(1));
        }
        targetPath = path.resolve(targetPath);

        if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
            await ctx.replyCard(CardManager.createServiceCard('❌ 错误', `目录不存在或无效: ${targetPath}`, 'error'));
            return;
        }

        const currentConfig = securityManager.getConfig();
        currentConfig.workspace = targetPath;
        securityManager.saveConfig(currentConfig);

        await ctx.replyCard(CardManager.createServiceCard('⏳ 切换中', `正在重启 OpenCode 引擎至:\n${targetPath}`, 'processing'));

        try {
            await startOpencodeEngine(targetPath);
            await ctx.replyCard(CardManager.createServiceCard('✅ 切换成功', `工作区已切换至:\n${targetPath}`, 'success'));
        } catch (err) {
            await ctx.replyCard(CardManager.createServiceCard('❌ 切换失败', `引擎重启失败: ${err.message}`, 'error'));
        }
    });

    const larkClient = createLarkClient(config);
    const storageManager = new StorageManager(path.join(ws.storage, 'history'));
    const bridge = new OpenCodeBridge('127.0.0.1', opencodePort);

    process.on('SIGTERM', () => {
        console.log('[CLEANUP] Killing opencode process...');
        if (opencodeProcess) opencodeProcess.kill('SIGTERM');
        process.exit(0);
    });

    process.on('SIGINT', () => {
        console.log('[CLEANUP] Killing opencode process...');
        if (opencodeProcess) opencodeProcess.kill('SIGINT');
        process.exit(0);
    });

    const activeSessions = new Map();

    const dispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
            const { message, sender } = data;
            let contentText = '';
            try {
                contentText = JSON.parse(message.content).text;
            } catch (e) {
                contentText = message.content;
            }
            const userId = sender.sender_id.user_id;
            const chatId = message.chat_id;

            console.log(`[EVENT] Received message from ${userId}: ${contentText}`);

            const ctx = {
                message: { ...message, content: contentText },
                sender,
                async replyCard(card, targetChatId = chatId) {
                    try {
                        return await larkClient.im.message.create({
                            params: { receive_id_type: 'chat_id' },
                            data: {
                                receive_id: targetChatId,
                                content: JSON.stringify(card),
                                msg_type: 'interactive',
                            },
                        });
                    } catch (err) {
                        console.error('[FEISHU ERROR] replyCard failed:', err.message);
                        throw err;
                    }
                }
            };

            const isWhitelisted = securityManager.isWhitelisted(userId);
            const adminId = securityManager.getAdmin();

            if (userId === adminId) {
                securityManager.setAdminChatId(chatId);
            }

            if (!isWhitelisted) {
                if (!adminId) {
                    await ctx.replyCard(CardManager.createServiceCard(
                        '⚠️ 访问受限',
                        `系统尚未配置管理员。\n\n您的 User ID: \`${userId}\`\n\n请在服务器执行以下命令进行授权：\n\`oc-channels whitelist add ${userId} admin\``,
                        'warning'
                    ));
                } else {
                    const adminChatId = securityManager.getAdminChatId();
                    if (adminChatId) {
                        await ctx.replyCard(CardManager.createAuthRequestCard(userId, chatId, contentText), adminChatId);
                        await ctx.replyCard(CardManager.createServiceCard(
                            '⏳ 申请已发送',
                            '您的访问申请已发送给管理员，请耐心等待。',
                            'processing'
                        ));
                    } else {
                        await ctx.replyCard(CardManager.createServiceCard(
                            '⚠️ 访问受限',
                            `您的账号尚未获得授权。\n\n管理员尚未激活（未发送过消息）。\n请联系管理员执行：\n\`oc-channels whitelist add ${userId}\``,
                            'warning'
                        ));
                    }
                    securityManager.logUnauthorized(userId, contentText);
                }
                return;
            }

            storageManager.logMessage(chatId, userId, 'user', contentText).catch(err => console.error('[STORAGE ERROR]', err.message));

            if (contentText.startsWith('#')) {
                const handled = await commandRegistry.handle(ctx);
                if (!handled && contentText === '#help') {
                    await ctx.replyCard(CardManager.createServiceCard('帮助', commandRegistry.getHelp(), 'processing'));
                } else if (!handled) {
                    await ctx.replyCard(CardManager.createServiceCard('错误', '未知指令', 'failed'));
                }
                return;
            }

            try {
                const sessionId = await bridge.createSession();
                const initialCard = CardManager.createOpenCodeCard('任务', '🚀 任务已下达...', 'processing');
                const cardResp = await ctx.replyCard(initialCard);
                const messageId = cardResp.data.message_id;

                activeSessions.set(sessionId, {
                    chat_id: chatId,
                    message_id: messageId,
                    content: '',
                    lastUpdate: 0,
                    connectionLost: false
                });

                console.log(`[SESSION] Bound ${sessionId} to message ${messageId}`);
                await bridge.sendPrompt(sessionId, contentText);
            } catch (err) {
                console.error('[OPCODE ERROR]', err.message);
                let errorMsg = '连接 OpenCode 失败，请确认服务已启动。';
                if (err.code === 'ECONNREFUSED' || err.message.includes('ECONNREFUSED')) {
                    errorMsg = '❌ OpenCode 服务未启动 (ECONNREFUSED)。请在服务器运行 `opencode` 后重试。';
                }
                await ctx.replyCard(CardManager.createServiceCard('❌ 服务故障', errorMsg, 'failed'));
            }
        },
        'card.action.trigger': async (data) => {
            const { action, operator } = data;
            const { value } = action;
            const adminId = operator.user_id;
            
            if (adminId !== securityManager.getAdmin()) {
                return {
                    toast: { type: 'error', content: '只有管理员可以操作' }
                };
            }

            const targetUserId = value.userId;
            const targetChatId = value.chatId;
            const actionType = value.action;

            if (actionType === 'approve') {
                securityManager.addToWhitelist(targetUserId);
                
                if (targetChatId) {
                    await larkClient.im.message.create({
                        params: { receive_id_type: 'chat_id' },
                        data: {
                            receive_id: targetChatId,
                            content: JSON.stringify(CardManager.createServiceCard('🎉 授权成功', '管理员已批准您的访问申请，现在可以开始使用了。', 'success')),
                            msg_type: 'interactive',
                        },
                    });
                }
                
                return CardManager.createServiceCard('✅ 授权成功', `已批准用户 \`${targetUserId}\` 的访问申请。`, 'success');
            } else if (actionType === 'deny') {
                if (targetChatId) {
                    await larkClient.im.message.create({
                        params: { receive_id_type: 'chat_id' },
                        data: {
                            receive_id: targetChatId,
                            content: JSON.stringify(CardManager.createServiceCard('🚫 授权已拒绝', '管理员拒绝了您的访问申请。', 'failed')),
                            msg_type: 'interactive',
                        },
                    });
                }

                return CardManager.createServiceCard('🚫 授权已拒绝', `已拒绝用户 \`${targetUserId}\` 的访问申请。`, 'failed');
            }
        }
    });

    const updateCard = (sid, meta) => {
        const now = Date.now();
        if (now - meta.lastUpdate > 3000) {
            console.log(`[SSE] Updating card for session ${sid}`);
            larkClient.im.message.patch({
                path: { message_id: meta.message_id },
                data: {
                    content: JSON.stringify(CardManager.createOpenCodeCard('执行中', meta.content || '...', 'processing'))
                }
            }).catch(err => console.error(`[SSE PATCH ERROR]`, err.message));
            meta.lastUpdate = now;
        }
    };

    bridge.listen((event) => {
        if (!event || typeof event !== 'object') return;
        const sid = event.sessionID || event.sessionId || event.session_id || 
            event.properties?.sessionID || event.properties?.sessionId || event.properties?.session_id ||
            event.properties?.part?.sessionID || event.properties?.part?.sessionId || event.properties?.part?.session_id ||
            event.properties?.info?.sessionID || event.properties?.info?.sessionId || event.properties?.info?.session_id ||
            event.properties?.info?.id ||
            event.part?.sessionID || event.part?.sessionId || event.part?.session_id;
        if (!sid || !activeSessions.has(sid)) return;

        const meta = activeSessions.get(sid);
        if (meta.connectionLost) {
            meta.connectionLost = false;
            console.log(`[SSE] Reconnected for session ${sid}`);
        }

        if (event.type === 'message.part.delta') {
            const role = event.role || event.properties?.role || event.part?.role || event.properties?.part?.role;
            if (role === 'user') return;
            
            const delta = event.delta || event.properties?.delta || '';
            meta.content += delta;
            updateCard(sid, meta);
        } else if (event.type === 'message.part.updated') {
            const role = event.role || event.properties?.role || event.part?.role || event.properties?.part?.role;
            if (role === 'user') return;

            const text = event.part?.text || event.properties?.part?.text || '';
            if (text.length > meta.content.length) {
                meta.content = text;
                updateCard(sid, meta);
            }
        } else if (event.type === 'session.idle' || event.type === 'message.completed') {
            console.log(`[SSE] Completed: ${sid}`);
            larkClient.im.message.patch({
                path: { message_id: meta.message_id },
                data: {
                    content: JSON.stringify(CardManager.createOpenCodeCard('✅ 任务完成', meta.content || '任务结束', 'success'))
                }
            }).catch(err => console.error(`[SSE FINAL ERROR]`, err.message));
            
            storageManager.logMessage(meta.chat_id, 'bot', 'assistant', meta.content).catch(err => console.error('[STORAGE ERROR]', err.message));
            activeSessions.delete(sid);
        }
    }, (err) => {
        const msg = err.message || 'Connection lost';
        console.error(chalk.red(`[SSE CONNECTION ERROR] ${msg}. Retrying...`));
        
        if (msg.includes('ECONNREFUSED')) {
            for (const meta of activeSessions.values()) {
                if (meta.connectionLost) continue;
                meta.connectionLost = true;
                larkClient.im.message.patch({
                    path: { message_id: meta.message_id },
                    data: {
                        content: JSON.stringify(CardManager.createOpenCodeCard('⚠️ 连接中断', 'OpenCode 服务已断开，正在尝试重连...', 'warning'))
                    }
                }).catch(() => {});
            }
        }
    });

    startWS(config, dispatcher);
    console.log(`[READY] Gateway is listening...`);
}

async function stopProcess() {
    let stopped = false;
    
    if (fs.existsSync(ws.engine)) {
        try {
            const engine = JSON.parse(fs.readFileSync(ws.engine, 'utf8'));
            process.kill(engine.pid, 'SIGTERM');
            stopped = true;
        } catch (e) {}
        fs.unlinkSync(ws.engine);
    }

    if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
        try {
            process.kill(pid, 'SIGTERM');
            let count = 0;
            while (count < 10) {
                try {
                    process.kill(pid, 0);
                    await new Promise(r => setTimeout(r, 500));
                    count++;
                } catch (e) {
                    break;
                }
            }
            if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
            stopped = true;
        } catch (e) {
            if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
        }
    }
    return stopped;
}

program
    .command('start')
    .description('启动服务')
    .option('-d, --daemon', '后台运行')
    .action(async (options) => {
        if (options.daemon) {
            if (fs.existsSync(pidFile)) {
                const pid = fs.readFileSync(pidFile, 'utf8');
                try {
                    process.kill(parseInt(pid), 0);
                    console.log(chalk.yellow(`服务已运行 (PID: ${pid})`));
                    return;
                } catch (e) {
                    fs.unlinkSync(pidFile);
                }
            }
            const out = fs.openSync(logFile, 'a');
            const err = fs.openSync(errorLogFile, 'a');
            const child = spawn(process.argv[0], [process.argv[1], 'internal-run'], {
                detached: true,
                stdio: ['ignore', out, err]
            });
            fs.writeFileSync(pidFile, child.pid.toString());
            child.unref();
            console.log(chalk.green(`✔ 已后台启动 (PID: ${child.pid})`));
        } else {
            console.log(boxen(chalk.green('OpenCode Channels'), { padding: 1, borderStyle: 'double' }));
            await runServer();
        }
    });

program
    .command('stop')
    .description('停止服务')
    .action(async () => {
        const spinner = ora('停止中...').start();
        if (await stopProcess()) spinner.succeed('已停止');
        else spinner.fail('未运行');
    });

program
    .command('restart')
    .description('重启服务')
    .action(async () => {
        await stopProcess();
        const child = spawn(process.argv[0], [process.argv[1], 'start', '--daemon'], {
            detached: true,
            stdio: 'ignore'
        });
        fs.writeFileSync(pidFile, child.pid.toString());
        child.unref();
        console.log(chalk.green(`✔ 已重启`));
    });

program
    .command('status')
    .description('查看服务运行状态')
    .action(() => {
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
            try {
                process.kill(pid, 0);
                console.log(chalk.green(`✔ 网关正在运行 (PID: ${pid})`));
            } catch (e) {
                console.log(chalk.yellow(`网关未运行 (但发现残留的 PID 文件: ${pid})`));
            }
        } else {
            console.log(chalk.gray('网关未运行'));
        }

        if (fs.existsSync(ws.engine)) {
            try {
                const engine = JSON.parse(fs.readFileSync(ws.engine, 'utf8'));
                process.kill(engine.pid, 0);
                console.log(chalk.green(`✔ OpenCode 正在运行 (PID: ${engine.pid}, Port: ${engine.port})`));
            } catch (e) {
                console.log(chalk.yellow(`OpenCode 未运行 (但发现残留的 engine 文件)`));
            }
        } else {
            console.log(chalk.gray('OpenCode 未运行'));
        }
    });

program
    .command('setup')
    .description('初始化配置')
    .action(async () => {
        const security = new SecurityManager(ws.config, ws.storage);
        const configData = security.getConfig();
        const answers = await inquirer.prompt([
            { name: 'appId', message: '飞书 App ID:', default: configData.feishu.appId },
            { name: 'appSecret', message: '飞书 App Secret:', default: configData.feishu.appSecret },
            { name: 'proxy', message: 'HTTP 代理 (可选):', default: configData.proxy }
        ]);
        configData.feishu.appId = answers.appId;
        configData.feishu.appSecret = answers.appSecret;
        configData.proxy = answers.proxy;
        security.saveConfig(configData);

        console.log(chalk.cyan('\n' + '━'.repeat(40)));
        console.log(chalk.bold('⚠️ 提醒:'));
        console.log('1. 事件订阅选 WebSocket');
        console.log('2. 添加事件: im.message.receive_v1');
        console.log('3. 权限: im:message, im:message:send_as_bot');
        console.log('4. 必须发布新版本！');
        console.log(chalk.cyan('━'.repeat(40) + '\n'));

        const { startNow } = await inquirer.prompt([
            { type: 'confirm', name: 'startNow', message: '是否立即启动？', default: true }
        ]);

        if (startNow) {
            await stopProcess();
            const child = spawn(process.argv[0], [process.argv[1], 'start', '--daemon'], {
                detached: true,
                stdio: 'ignore'
            });
            fs.writeFileSync(pidFile, child.pid.toString());
            child.unref();
            console.log(chalk.green(`✔ 已后台启动 (PID: ${child.pid})`));
        }
    });

program
    .command('whitelist')
    .description('管理授权')
    .argument('[action]', 'add|list|remove', 'list')
    .argument('[id]', 'User ID')
    .argument('[role]', 'admin|user', 'user')
    .action(async (action, id, role) => {
        const security = new SecurityManager(ws.config, ws.storage);
        const configData = security.getConfig();
        if (action === 'list') {
            console.log(chalk.bold('\n授权列表:'));
            if (configData.admin) console.log(chalk.blue(`[ADMIN] ${configData.admin}`));
            if (configData.whitelist) configData.whitelist.forEach(uid => {
                if (uid !== configData.admin) console.log(` - ${uid}`);
            });
            const logPath = path.join(ws.storage, 'unauthorized.log');
            if (fs.existsSync(logPath)) {
                const unauthorized = fs.readFileSync(logPath, 'utf8').trim();
                if (unauthorized) {
                    console.log(chalk.red('\n未授权记录:'));
                    console.log(unauthorized);
                }
            }
        } else if (action === 'add' && id) {
            let success = false;
            if (role === 'admin') {
                security.setAdmin(id);
                console.log(chalk.green(`已设置 ${id} 为管理员`));
                success = true;
            } else {
                if (security.addToWhitelist(id)) {
                    console.log(chalk.green(`已授权 ${id}`));
                    success = true;
                } else {
                    console.log(chalk.yellow(`${id} 已在授权列表中`));
                    success = true;
                }
            }

            if (success) {
                try {
                    const larkClient = createLarkClient(configData);
                    const message = role === 'admin' 
                        ? '您已被授权为管理员，现在可以开始使用了。' 
                        : '您已被授权访问，现在可以开始使用了。';
                    
                    await larkClient.im.message.create({
                        params: { receive_id_type: 'user_id' },
                        data: {
                            receive_id: id,
                            content: JSON.stringify(CardManager.createServiceCard('🎉 授权成功', message, 'success')),
                            msg_type: 'interactive',
                        },
                    });
                    console.log(chalk.cyan(`已向用户 ${id} 发送飞书通知`));
                } catch (err) {
                    console.error(chalk.red(`[FEISHU ERROR] 无法发送通知: ${err.message}`));
                }
            }
        } else if (action === 'remove' && id) {
            const config = security.getConfig();
            if (config.whitelist) {
                config.whitelist = config.whitelist.filter(uid => uid !== id);
                if (config.admin === id) config.admin = null;
                security.saveConfig(config);
                console.log(chalk.green(`已移除 ${id} 的授权`));
            }
        }
        process.exit(0);
    });

program
    .command('internal-run', { hidden: true })
    .action(async () => {
        await runServer();
    });

program.parse();
