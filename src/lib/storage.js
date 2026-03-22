const fs = require('fs');
const path = require('path');

class StorageManager {
    constructor(historyDir) {
        this.historyDir = path.resolve(historyDir);
        if (!fs.existsSync(this.historyDir)) {
            fs.mkdirSync(this.historyDir, { recursive: true });
        }
    }

    async logMessage(chatId, userId, role, content) {
        const filePath = path.join(this.historyDir, `chat_${chatId}.jsonl`);
        const entry = JSON.stringify({
            timestamp: new Date().toISOString(),
            userId,
            role,
            content
        }) + '\n';
        
        return new Promise((resolve, reject) => {
            fs.appendFile(filePath, entry, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getLastMessages(chatId, n = 10) {
        const filePath = path.join(this.historyDir, `chat_${chatId}.jsonl`);
        if (!fs.existsSync(filePath)) return [];
        
        const content = fs.readFileSync(filePath, 'utf8').trim();
        const lines = content.split('\n');
        return lines.slice(-n).map(line => JSON.parse(line));
    }
}

module.exports = StorageManager;
