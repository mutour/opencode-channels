const axios = require('axios');
const EventSource = require('eventsource').EventSource || require('eventsource');

class OpenCodeBridge {
    constructor(host = '127.0.0.1', port = 4096) {
        this.baseUrl = `http://${host}:${port}`;
    }

    async createSession() {
        const { data } = await axios.post(`${this.baseUrl}/session`);
        return data.id || data.sessionID || data.sessionId || data.session_id;
    }

    async sendPrompt(sessionId, text) {
        await axios.post(`${this.baseUrl}/session/${sessionId}/prompt_async`, {
            parts: [{ type: 'text', text }]
        });
    }

    listen(onEvent, onError) {
        const es = new EventSource(`${this.baseUrl}/event`);
        
        es.onopen = () => {
            console.log(`[SSE] Connected to OpenCode at ${this.baseUrl}/event`);
        };

        const handler = (event) => {
            try {
                if (!event.data) return;
                const data = JSON.parse(event.data);
                // The SDK might not include event.type inside the JSON if it's sent as the SSE event name
                if (!data.type && event.type !== 'message') {
                    data.type = event.type;
                }
                onEvent(data);
            } catch (err) {
                console.error('Failed to parse SSE data:', err);
            }
        };

        es.onmessage = handler;
        // Listen to specific named events OpenCode might send
        es.addEventListener('message.part.updated', handler);
        es.addEventListener('message.part.delta', handler);
        es.addEventListener('message.completed', handler);
        es.addEventListener('session.idle', handler);
        es.addEventListener('session.status', handler);

        es.onerror = (err) => {
            onError(err);
        };

        return es;
    }
}

module.exports = OpenCodeBridge;
