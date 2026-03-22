module.exports = {
    command: 'date',
    description: 'Get system time',
    async execute(ctx) {
        await ctx.reply(`Current system time: ${new Date().toLocaleString()}`);
    }
};
