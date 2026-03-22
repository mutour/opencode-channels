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
        console.error(chalk.red('Configuration incomplete, please run first: npm run setup'));
        process.exit(1);
    }

    const opencodePort = await findFreePort();
    let opencodeProcess = null;

    async function startOpencodeEngine(cwd) {
        if (opencodeProcess) {
            console.log(chalk.yellow(`[OPCODE] Stopping existing opencode process (PID: ${opencodeProcess.pid})...`));
            try {
                opencodeProcess.kill('SIGTERM');
                let count = 0;
                while (count < 15) {
                    try {
                        process.kill(opencodeProcess.pid, 0);
                        await new Promise(r => setTimeout(r, 200));
                        count++;
                    } catch (e) { break; }
                }
                try { process.kill(opencodeProcess.pid, 'SIGKILL'); } catch (e) {}
            } catch (err) {}
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

    commandRegistry.registerBuiltIn('help', 'Show this help message', async (ctx, args) => {
        await ctx.replyCard(CardManager.createServiceCard('Help', commandRegistry.getHelp(), 'success'));
    });

    commandRegistry.registerBuiltIn('commands', 'List all supported commands', async (ctx, args) => {
        await ctx.replyCard(CardManager.createServiceCard('Commands', commandRegistry.getHelp(), 'success'));
    });

    commandRegistry.registerBuiltIn('workspace', 'Switch OpenCode workspace directory', async (ctx, args) => {
        if (args.length === 0) {
            await ctx.replyCard(CardManager.createServiceCard('⚠️ Notice', 'Please provide a directory path, for example: #workspace ~/projects/my-app', 'warning'));
            return;
        }
        let targetPath = args.join(' ');
        if (targetPath.startsWith('~')) {
            targetPath = path.join(os.homedir(), targetPath.slice(1));
        }
        targetPath = path.resolve(targetPath);

        if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
            await ctx.replyCard(CardManager.createServiceCard('❌ Error', `Directory does not exist or is invalid: ${targetPath}`, 'error'));
            return;
        }

        const currentConfig = securityManager.getConfig();
        currentConfig.workspace = targetPath;
        securityManager.saveConfig(currentConfig);

        await ctx.replyCard(CardManager.createServiceCard('⏳ Switching', `Restarting OpenCode engine to:\n${targetPath}`, 'processing'));

        try {
            await startOpencodeEngine(targetPath);
            await ctx.replyCard(CardManager.createServiceCard('✅ Switch Success', `Workspace switched to:\n${targetPath}`, 'success'));
        } catch (err) {
            await ctx.replyCard(CardManager.createServiceCard('❌ Switch Failed', `Engine restart failed: ${err.message}`, 'error'));
        }
    });

    const larkClient = createLarkClient(config);
    const storageManager = new StorageManager(path.join(ws.storage, 'history'));
    const bridge = new OpenCodeBridge('127.0.0.1', opencodePort);

    const shutdown = async () => {
        console.log('[CLEANUP] Shutting down gateway and OpenCode engine...');
        if (opencodeProcess) {
            try {
                opencodeProcess.kill('SIGTERM');
                let count = 0;
                while (count < 15) {
                    try {
                        process.kill(opencodeProcess.pid, 0);
                        await new Promise(r => setTimeout(r, 200));
                        count++;
                    } catch (e) { break; }
                }
                try { process.kill(opencodeProcess.pid, 'SIGKILL'); } catch (e) {}
            } catch (e) {}
        }
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    
    process.on('uncaughtException', (err) => {
        console.error('[UNCAUGHT EXCEPTION]', err);
        shutdown();
    });
    
    process.on('unhandledRejection', (reason) => {
        console.error('[UNHANDLED REJECTION]', reason);
        shutdown();
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
                },
                async reply(text, targetChatId = chatId) {
                    try {
                        return await larkClient.im.message.create({
                            params: { receive_id_type: 'chat_id' },
                            data: {
                                receive_id: targetChatId,
                                content: JSON.stringify({ text: text }),
                                msg_type: 'text',
                            },
                        });
                    } catch (err) {
                        console.error('[FEISHU ERROR] reply text failed:', err.message);
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
                        '⚠️ Access Restricted',
                        `System has no admin configured.\n\nYour User ID: \`${userId}\`\n\nPlease run the following command on the server to authorize:\n\`npm run whitelist -- add ${userId} admin\``,
                        'warning'
                    ));
                } else {
                    const adminChatId = securityManager.getAdminChatId();
                    if (adminChatId) {
                        await ctx.replyCard(CardManager.createAuthRequestCard(userId, chatId, contentText), adminChatId);
                        await ctx.replyCard(CardManager.createServiceCard(
                            '⏳ Request Sent',
                            'Your access request has been sent to the admin, please wait patiently.',
                            'processing'
                        ));
                    } else {
                        await ctx.replyCard(CardManager.createServiceCard(
                            '⚠️ Access Restricted',
                            `Your account is not authorized.\n\nAdmin has not been activated yet (never sent a message).\nPlease ask the admin to run:\n\`npm run whitelist -- add ${userId}\``,
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
                if (!handled) {
                    await ctx.replyCard(CardManager.createServiceCard('Error', 'Unknown command', 'failed'));
                }
                return;
            }

            try {
                const sessionId = await bridge.createSession();
                const initialCard = CardManager.createOpenCodeCard('Task', '🚀 Task submitted...', 'processing');
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
                let errorMsg = 'Failed to connect to OpenCode, please ensure the service is running.';
                if (err.code === 'ECONNREFUSED' || err.message.includes('ECONNREFUSED')) {
                    errorMsg = '❌ OpenCode service is not running (ECONNREFUSED). Please run `opencode` on the server and try again.';
                }
                await ctx.replyCard(CardManager.createServiceCard('❌ Service Failure', errorMsg, 'failed'));
            }
        },
        'card.action.trigger': async (data) => {
            const { action, operator } = data;
            const { value } = action;
            const adminId = operator.user_id;
            
            if (adminId !== securityManager.getAdmin()) {
                return {
                    toast: { type: 'error', content: 'Only admins can perform this action' }
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
                            content: JSON.stringify(CardManager.createServiceCard('🎉 Authorization Success', 'Admin has approved your access request, you can now start using it.', 'success')),
                            msg_type: 'interactive',
                        },
                    });
                }
                
                return CardManager.createServiceCard('✅ Authorization Success', `Approved access request for user \`${targetUserId}\`.`, 'success');
            } else if (actionType === 'deny') {
                if (targetChatId) {
                    await larkClient.im.message.create({
                        params: { receive_id_type: 'chat_id' },
                        data: {
                            receive_id: targetChatId,
                            content: JSON.stringify(CardManager.createServiceCard('🚫 Authorization Denied', 'Admin has denied your access request.', 'failed')),
                            msg_type: 'interactive',
                        },
                    });
                }

                return CardManager.createServiceCard('🚫 Authorization Denied', `Denied access request for user \`${targetUserId}\`.`, 'failed');
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
                    content: JSON.stringify(CardManager.createOpenCodeCard('Processing', meta.content || '...', 'processing'))
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
                    content: JSON.stringify(CardManager.createOpenCodeCard('✅ Task Completed', meta.content || 'Task finished', 'success'))
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
                        content: JSON.stringify(CardManager.createOpenCodeCard('⚠️ Connection Lost', 'OpenCode service disconnected, attempting to reconnect...', 'warning'))
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
            const pid = parseInt(engine.pid, 10);
            process.kill(pid, 'SIGTERM');
            let count = 0;
            while (count < 15) {
                try {
                    process.kill(pid, 0);
                    await new Promise(r => setTimeout(r, 200));
                    count++;
                } catch (e) { break; }
            }
            try { process.kill(pid, 'SIGKILL'); } catch (e) {}
            stopped = true;
        } catch (e) {}
        try { fs.unlinkSync(ws.engine); } catch (e) {}
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

function startDaemon() {
    if (fs.existsSync(pidFile)) {
        const pid = fs.readFileSync(pidFile, 'utf8');
        try {
            process.kill(parseInt(pid), 0);
            console.log(chalk.yellow(`Service already running (PID: ${pid})`));
            return false;
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
    console.log(chalk.green(`✔ Started in background (PID: ${child.pid})`));
    return true;
}

program
    .command('start')
    .description('Start service in background')
    .option('-l, --log', 'Run in foreground and show logs')
    .action(async (options) => {
        if (!options.log) {
            startDaemon();
        } else {
            console.log(boxen(chalk.green('OpenCode Channels'), { padding: 1, borderStyle: 'double' }));
            await runServer();
        }
    });

program
    .command('stop')
    .description('Stop service')
    .action(async () => {
        const spinner = ora('Stopping...').start();
        if (await stopProcess()) spinner.succeed('Stopped');
        else spinner.fail('Not running');
    });

program
    .command('restart')
    .description('Restart service')
    .action(async () => {
        await stopProcess();
        if (startDaemon()) {
            console.log(chalk.green(`✔ Restarted`));
        }
    });

program
    .command('status')
    .description('Check service status')
    .action(() => {
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
            try {
                process.kill(pid, 0);
                console.log(chalk.green(`✔ Gateway is running (PID: ${pid})`));
            } catch (e) {
                console.log(chalk.yellow(`Gateway not running (but stale PID file found: ${pid})`));
            }
        } else {
            console.log(chalk.gray('Gateway not running'));
        }

        if (fs.existsSync(ws.engine)) {
            try {
                const engine = JSON.parse(fs.readFileSync(ws.engine, 'utf8'));
                process.kill(engine.pid, 0);
                console.log(chalk.green(`✔ OpenCode is running (PID: ${engine.pid}, Port: ${engine.port})`));
            } catch (e) {
                console.log(chalk.yellow(`OpenCode not running (but stale engine file found)`));
            }
        } else {
            console.log(chalk.gray('OpenCode not running'));
        }
    });

program
    .command('setup')
    .description('Initialize configuration')
    .action(async () => {
        const security = new SecurityManager(ws.config, ws.storage);
        const configData = security.getConfig();
        const answers = await inquirer.prompt([
            { name: 'appId', message: 'Feishu App ID:', default: configData.feishu.appId },
            { name: 'appSecret', message: 'Feishu App Secret:', default: configData.feishu.appSecret },
            { name: 'proxy', message: 'HTTP Proxy (Optional):', default: configData.proxy }
        ]);
        configData.feishu.appId = answers.appId;
        configData.feishu.appSecret = answers.appSecret;
        configData.proxy = answers.proxy;
        security.saveConfig(configData);

        console.log(chalk.cyan('\n' + '━'.repeat(40)));
        console.log(chalk.bold('⚠️ Notice:'));
        console.log('1. Choose WebSocket for event subscription');
        console.log('2. Add event: im.message.receive_v1');
        console.log('3. Permissions: im:message, im:message:send_as_bot');
        console.log('4. You must publish a new version!');
        console.log(chalk.cyan('━'.repeat(40) + '\n'));

        const { startNow } = await inquirer.prompt([
            { type: 'confirm', name: 'startNow', message: 'Start immediately?', default: true }
        ]);

        if (startNow) {
            await stopProcess();
            startDaemon();
        }
    });

program
    .command('whitelist')
    .description('Manage authorization')
    .argument('[action]', 'add|list|remove', 'list')
    .argument('[id]', 'User ID')
    .argument('[role]', 'admin|user', 'user')
    .action(async (action, id, role) => {
        const security = new SecurityManager(ws.config, ws.storage);
        const configData = security.getConfig();
        if (action === 'list') {
            console.log(chalk.bold('\nAuthorization List:'));
            if (configData.admin) console.log(chalk.blue(`[ADMIN] ${configData.admin}`));
            if (configData.whitelist) configData.whitelist.forEach(uid => {
                if (uid !== configData.admin) console.log(` - ${uid}`);
            });
            const logPath = path.join(ws.storage, 'unauthorized.log');
            if (fs.existsSync(logPath)) {
                const unauthorized = fs.readFileSync(logPath, 'utf8').trim();
                if (unauthorized) {
                    console.log(chalk.red('\nUnauthorized access records:'));
                    console.log(unauthorized);
                }
            }
        } else if (action === 'add' && id) {
            let success = false;
            if (role === 'admin') {
                security.setAdmin(id);
                console.log(chalk.green(`Set ${id} as admin`));
                success = true;
            } else {
                if (security.addToWhitelist(id)) {
                    console.log(chalk.green(`Authorized ${id}`));
                    success = true;
                } else {
                    console.log(chalk.yellow(`${id} is already in the whitelist`));
                    success = true;
                }
            }

            if (success) {
                try {
                    const larkClient = createLarkClient(configData);
                    const message = role === 'admin' 
                        ? 'You have been authorized as an admin, you can start using the service now.' 
                        : 'You have been authorized, you can start using the service now.';
                    
                    await larkClient.im.message.create({
                        params: { receive_id_type: 'user_id' },
                        data: {
                            receive_id: id,
                            content: JSON.stringify(CardManager.createServiceCard('🎉 Authorization Success', message, 'success')),
                            msg_type: 'interactive',
                        },
                    });
                    console.log(chalk.cyan(`Sent Feishu notification to user ${id}`));
                } catch (err) {
                    console.error(chalk.red(`[FEISHU ERROR] Failed to send notification: ${err.message}`));
                }
            }
        } else if (action === 'remove' && id) {
            const config = security.getConfig();
            if (config.whitelist) {
                config.whitelist = config.whitelist.filter(uid => uid !== id);
                if (config.admin === id) config.admin = null;
                security.saveConfig(config);
                console.log(chalk.green(`Removed authorization for ${id}`));
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
