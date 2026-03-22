const lark = require('@larksuiteoapi/node-sdk');
const HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent || require('https-proxy-agent');

function createLarkClient(config) {
    const httpInstance = lark.defaultHttpInstance;
    httpInstance.defaults.timeout = 10000;

    if (config.proxy) {
        const agent = new HttpsProxyAgent(config.proxy);
        httpInstance.defaults.httpsAgent = agent;
        httpInstance.defaults.httpAgent = agent;
        httpInstance.defaults.proxy = false;
    }

    return new lark.Client({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        domain: lark.Domain.Feishu,
        httpInstance: httpInstance,
    });
}

function startWS(config, dispatcher) {
    const wsConfig = {
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        domain: lark.Domain.Feishu,
        autoReconnect: true,
    };

    if (config.proxy) {
        const agent = new HttpsProxyAgent(config.proxy);
        wsConfig.agent = agent;
        
        const httpInstance = lark.defaultHttpInstance;
        httpInstance.defaults.httpsAgent = agent;
        httpInstance.defaults.httpAgent = agent;
        httpInstance.defaults.proxy = false;
        httpInstance.defaults.timeout = 10000;
        wsConfig.httpInstance = httpInstance;
    }

    const wsClient = new lark.WSClient(wsConfig);
    wsClient.start({ eventDispatcher: dispatcher });
    return wsClient;
}

module.exports = {
    createLarkClient,
    startWS,
};
