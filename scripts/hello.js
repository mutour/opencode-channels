module.exports = {
    command: 'hello',
    description: 'Say hello',
    async execute(ctx) {
        await ctx.reply('Hello! I am the OpenCode Channels gateway.');
    }
};
