module.exports = {
    command: 'hello',
    description: '打招呼',
    async execute(ctx) {
        await ctx.reply('你好！我是 OpenCode Channels 网关。');
    }
};
