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
                    elements: [{ tag: 'plain_text', content: `Status: ${status === 'processing' ? 'Processing...' : 'Task Completed'}` }]
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
                    elements: [{ tag: 'plain_text', content: `Status: ${status === 'processing' ? 'Processing...' : 'Task Completed'}` }]
                }
            ]
        };
    }

    static createAuthRequestCard(userId, chatId, content) {
        return {
            config: { wide_screen_mode: true },
            header: {
                title: { tag: 'plain_text', content: '🔐 Authorization Request' },
                template: 'orange'
            },
            elements: [
                {
                    tag: 'div',
                    text: { tag: 'lark_md', content: `**User ID**: \`${userId}\` is requesting access.\n\n**Request content**: ${content}` }
                },
                {
                    tag: 'action',
                    actions: [
                        {
                            tag: 'button',
                            text: { tag: 'plain_text', content: 'Approve' },
                            type: 'primary',
                            value: { action: 'approve', userId: userId, chatId: chatId }
                        },
                        {
                            tag: 'button',
                            text: { tag: 'plain_text', content: 'Deny' },
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
        return `Progress: [${bar}] ${progress}%`;
    }
}

module.exports = CardManager;
