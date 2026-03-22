module.exports = {
    command: 'date',
    description: '获取系统时间',
    async execute(ctx) {
        await ctx.reply(`当前系统时间: ${new Date().toLocaleString()}`);
    }
};
