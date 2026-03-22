# OpenCode Channels (Feishu/Lark Gateway)

## Project Overview
`opencode-channels` is a server-side gateway application that bridges **Feishu/Lark** with the **OpenCode Engine**. 
With this project, users can send commands directly to OpenCode from their Feishu/Lark chat window, and receive real-time execution status and text responses from the AI.

## Core Workflow
1. **Message Reception**: Users send messages to the Feishu/Lark bot, which are captured by the gateway via Lark's WebSocket event subscription mechanism (`im.message.receive_v1`).
2. **Security & Whitelist Flow**:
   - **Admin Initialization**: There is no default admin when the system runs for the first time. The first user to send a message will receive a prompt card with their `User ID`. An administrator must then run the command `npm run whitelist -- add <userId> admin` on the server to bind the admin account.
   - **Admin Activation**: Once bound, the admin needs to send any message to the bot to "activate" the session (so the gateway registers the admin's `chat_id`), which is required to receive future authorization requests.
   - **Guest Authorization Request**: When an un-whitelisted user sends a message, and the admin is activated, the gateway will push a **"🔐 Authorization Request"** interactive card to the admin. The admin can click "Approve" or "Deny" directly from the chat.
   - **Manual Authorization**: If the admin is not activated or prefers CLI, authorization can still be granted via the server command: `npm run whitelist -- add <userId>`.
3. **Built-in Command Interception**: Messages starting with `#` (e.g., `#help`, `#commands`) are intercepted and handled by the local `CommandRegistry`, and are not forwarded to the OpenCode AI model.
4. **OpenCode Task Dispatch**:
   - Establishes a new session (`POST /session`).
   - Immediately replies to the user with an **"OpenCode Processing..."** Interactive Card in Feishu, saving the message ID for future updates.
   - Asynchronously sends the user's prompt to the OpenCode API (`POST /session/{id}/prompt_async`).
5. **SSE Stream Updates**:
   - A global long-lived listener is established on the OpenCode engine's `/event` SSE stream.
   - As OpenCode generates text or advances steps, the gateway associates the event back to the original user via `sessionID` and accumulates incremental text.
   - The Feishu card is updated periodically (throttled, e.g., every 3 seconds) via `PATCH /im/v1/messages/:message_id`.
   - When the event stream indicates the session is idle or complete, the card is finalized as **"✅ Task Completed"**, and the conversation is written to local storage.

## Installation & Usage

You can install and use `opencode-channels` either locally or globally. We recommend global installation to use the CLI commands easily from anywhere.

### Option 1: Global Installation (Recommended)

1. **Configure npm to access GitHub Packages**:
   Since this package is hosted on the GitHub Packages registry, you need to configure your environment first. If you haven't already, add the following to your `~/.npmrc` file:
   ```bash
   @mutour:registry=https://npm.pkg.github.com
   ```
   *(Note: You will also need to be authenticated with `npm login --registry=https://npm.pkg.github.com` using a GitHub Personal Access Token if the package is private).*

2. **Install globally**:
   ```bash
   npm install -g @mutour/opencode-channels
   ```

3. **Initialize configuration** interactively (requires your Feishu App ID and App Secret):
   ```bash
   oc-channels setup
   ```

### Option 2: Run via `npx` (No installation required)

If you prefer not to install it globally, you can run it directly using `npx`:
```bash
npx @mutour/opencode-channels setup
```

---

## Basic Management

Once configured, you can manage the gateway using the `oc-channels` CLI command (or prefix with `npx @mutour/opencode-channels` if using Option 2):

- `oc-channels start`: Start the gateway service in the background (daemon mode).
- `oc-channels start -l, --log`: Start the gateway service in the foreground and output logs.
- `oc-channels stop`: Stop the background service.
- `oc-channels restart`: Restart the background service.
- `oc-channels status`: Check if the gateway and OpenCode engine are currently running.

## Permission Management (`whitelist`)

Use the `whitelist` command to manage user access:

- `oc-channels whitelist list`: View the current admin, whitelisted users, and unauthorized access logs.
- `oc-channels whitelist add <userId> [admin]`: Authorize a user. Adding the `admin` parameter grants admin privileges.
- `oc-channels whitelist remove <userId>`: Remove a user's authorization.

## Writing Custom Gateway Commands
You can write your own interceptor commands inside the `scripts/` directory. Create a new `.js` file exporting a command structure:

```javascript
module.exports = {
    command: 'hello',
    description: 'Say hello',
    async execute(ctx, args) {
        await ctx.replyCard({ /* Feishu Card JSON */ });
        // or
        // await ctx.reply('Hello! I am the OpenCode Channels gateway.');
    }
};
```
These will automatically become available via `#hello` in your Feishu chat. Use `#commands` or `#help` to see all registered commands.
