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
            admin: "",
            opencode: { port: 4096, host: "127.0.0.1" }
        };
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    }

    return {
        root: workspace,
        config: configPath,
        scripts: path.join(workspace, 'scripts'),
        storage: path.join(workspace, 'storage'),
        logs: path.join(workspace, 'logs')
    };
}

module.exports = { getWorkspace };
