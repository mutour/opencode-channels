class CardManager {
    static createBaseCard(title, content, status = 'processing') {
        const statusColors = {
            processing: 'blue',
            success: 'green',
            failed: 'red',
            warning: 'orange'
        };

        return {
            config: { wide_screen_mode: true },
            header: {
                title: { tag: 'plain_text', content: title },
                template: statusColors[status] || 'blue'
            },
            elements: [
                {
                    tag: 'div',
                    text: { tag: 'lark_md', content: content }
                },
                {
                    tag: 'hr'
                },
                {
                    tag: 'note',
                    elements: [{ tag: 'plain_text', content: `状态: ${status === 'processing' ? '正在执行...' : '任务完成'}` }]
                }
            ]
        };
    }

    static createServiceCard(title, content, status = 'processing') {
        const statusColors = {
            processing: 'blue',
            success: 'green',
            failed: 'red',
            warning: 'orange'
        };

        return {
            config: { wide_screen_mode: true },
            header: {
                title: { tag: 'plain_text', content: `[Service] ${title}` },
                template: statusColors[status] || 'blue'
            },
            elements: [
                {
                    tag: 'div',
                    text: { tag: 'lark_md', content: content }
                }
            ]
        };
    }

    static createOpenCodeCard(title, content, status = 'processing') {
        const statusColors = {
            processing: 'blue',
            success: 'green',
            failed: 'red',
            warning: 'orange'
        };

        return {
            config: { wide_screen_mode: true },
            header: {
                title: { tag: 'plain_text', content: `[OpenCode] ${title}` },
                template: statusColors[status] || 'blue'
            },
            elements: [
                {
                    tag: 'div',
                    text: { tag: 'lark_md', content: content }
                },
                {
                    tag: 'hr'
                },
                {
                    tag: 'note',
                    elements: [{ tag: 'plain_text', content: `状态: ${status === 'processing' ? '正在执行...' : '任务完成'}` }]
                }
            ]
        };
    }

    static createAuthRequestCard(userId, chatId, content) {
        return {
            config: { wide_screen_mode: true },
            header: {
                title: { tag: 'plain_text', content: '🔐 授权申请' },
                template: 'orange'
            },
            elements: [
                {
                    tag: 'div',
                    text: { tag: 'lark_md', content: `**用户 ID**: \`${userId}\` 正在申请访问权限。\n\n**申请内容**: ${content}` }
                },
                {
                    tag: 'action',
                    actions: [
                        {
                            tag: 'button',
                            text: { tag: 'plain_text', content: '批准' },
                            type: 'primary',
                            value: { action: 'approve', userId: userId, chatId: chatId }
                        },
                        {
                            tag: 'button',
                            text: { tag: 'plain_text', content: '拒绝' },
                            type: 'danger',
                            value: { action: 'deny', userId: userId, chatId: chatId }
                        }
                    ]
                }
            ]
        };
    }

    static getProgressIndicator(progress) {
        const total = 10;
        const filled = Math.round(progress / 10);
        const bar = '█'.repeat(filled) + '░'.repeat(total - filled);
        return `进度: [${bar}] ${progress}%`;
    }
}

module.exports = CardManager;
