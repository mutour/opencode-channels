const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

class CommandRegistry {
    constructor(scriptsDir) {
        this.scriptsDir = path.resolve(scriptsDir);
        this.commands = new Map();
        this.watcher = null;
    }

    async init() {
        if (!fs.existsSync(this.scriptsDir)) {
            fs.mkdirSync(this.scriptsDir, { recursive: true });
        }
        await this.loadAll();
        this.startWatcher();
    }

    registerBuiltIn(command, description, execute) {
        this.commands.set(command, { command, description, execute });
    }

    async loadAll() {
        const files = fs.readdirSync(this.scriptsDir);
        for (const file of files) {
            if (file.endsWith('.js')) {
                await this.loadScript(file);
            }
        }
    }

    async loadScript(fileName) {
        const filePath = path.join(this.scriptsDir, fileName);
        try {
            delete require.cache[require.resolve(filePath)];
            const script = require(filePath);
            if (script.command && typeof script.execute === 'function') {
                this.commands.set(script.command, script);
            }
        } catch (err) {
            console.error(`Failed to load script ${fileName}:`, err);
        }
    }

    startWatcher() {
        this.watcher = chokidar.watch(this.scriptsDir, { ignoreInitial: true });
        this.watcher.on('add', (filePath) => this.loadScript(path.basename(filePath)));
        this.watcher.on('change', (filePath) => this.loadScript(path.basename(filePath)));
        this.watcher.on('unlink', (filePath) => {
            const fileName = path.basename(filePath);
            for (const [cmd, script] of this.commands.entries()) {
                if (fileName.includes(cmd)) {
                    this.commands.delete(cmd);
                }
            }
        });
    }

    async handle(ctx) {
        const text = ctx.message.content.trim();
        if (!text.startsWith('#')) return false;

        const [cmdName, ...args] = text.slice(1).split(/\s+/);
        const script = this.commands.get(cmdName);

        if (script) {
            await script.execute(ctx, args);
            return true;
        }
        return false;
    }

    getHelp() {
        let help = 'Gateway Commands (starts with #):\n';
        for (const script of this.commands.values()) {
            help += `#${script.command}: ${script.description || 'No description'}\n`;
        }
        return help;
    }
}

module.exports = CommandRegistry;
