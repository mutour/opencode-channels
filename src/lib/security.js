const fs = require('fs');
const path = require('path');

class SecurityManager {
    constructor(configPath, storageDir) {
        this.configPath = path.resolve(configPath);
        this.unauthorizedLogPath = path.join(storageDir, 'unauthorized.log');
    }

    getConfig() {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    }

    saveConfig(config) {
        fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    }

    isWhitelisted(userId) {
        const config = this.getConfig();
        return (config.whitelist && config.whitelist.includes(userId)) || config.admin === userId;
    }

    getAdmin() {
        const config = this.getConfig();
        return config.admin;
    }

    getAdminChatId() {
        const config = this.getConfig();
        return config.adminChatId;
    }

    setAdminChatId(chatId) {
        const config = this.getConfig();
        config.adminChatId = chatId;
        this.saveConfig(config);
    }

    logUnauthorized(userId, content) {
        const logEntry = `${new Date().toISOString()} | ${userId} | ${content}\n`;
        if (!fs.existsSync(path.dirname(this.unauthorizedLogPath))) {
            fs.mkdirSync(path.dirname(this.unauthorizedLogPath), { recursive: true });
        }
        fs.appendFileSync(this.unauthorizedLogPath, logEntry);
    }

    addToWhitelist(userId) {
        const config = this.getConfig();
        if (!config.whitelist) config.whitelist = [];
        if (!config.whitelist.includes(userId)) {
            config.whitelist.push(userId);
            this.saveConfig(config);
            return true;
        }
        return false;
    }

    setAdmin(userId) {
        const config = this.getConfig();
        config.admin = userId;
        if (!config.whitelist) config.whitelist = [];
        if (!config.whitelist.includes(userId)) {
            config.whitelist.push(userId);
        }
        this.saveConfig(config);
    }
}

module.exports = SecurityManager;
