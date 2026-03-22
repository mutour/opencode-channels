const os = require('os');
const fs = require('fs');
const path = require('path');

function getWorkspace() {
    const workspace = process.env.OPENCODE_CHANNELS_HOME || path.join(os.homedir(), '.opencode-channels');
    
    const dirs = [
        workspace,
        path.join(workspace, 'scripts'),
        path.join(workspace, 'storage'),
        path.join(workspace, 'storage/history'),
        path.join(workspace, 'logs')
    ];

    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    const configPath = path.join(workspace, 'config.json');
    if (!fs.existsSync(configPath)) {
        const defaultConfig = {
            feishu: { appId: "", appSecret: "", domain: "https://open.feishu.cn" },
            proxy: "",
            whitelist: [],
            admin: ""
        };
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    }

    const defaultScriptsDir = path.join(__dirname, '../../scripts');
    const userScriptsDir = path.join(workspace, 'scripts');
    if (fs.existsSync(defaultScriptsDir)) {
        const scripts = fs.readdirSync(defaultScriptsDir);
        for (const file of scripts) {
            if (file.endsWith('.js')) {
                const targetPath = path.join(userScriptsDir, file);
                if (!fs.existsSync(targetPath)) {
                    fs.copyFileSync(path.join(defaultScriptsDir, file), targetPath);
                }
            }
        }
    }

    return {
        root: workspace,
        config: configPath,
        engine: path.join(workspace, 'engine.json'),
        scripts: userScriptsDir,
        storage: path.join(workspace, 'storage'),
        logs: path.join(workspace, 'logs')
    };
}

module.exports = { getWorkspace };
