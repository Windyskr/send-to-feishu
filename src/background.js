import { defaultSettings, messageTypes } from './utils/constants.js';
import { getStorageData, setStorageData } from './utils/storage.js';

// Add context menu items and set default settings on install
const contextTypes = ['text', 'link', 'page', 'image'];
chrome.runtime.onInstalled.addListener(async details => {
    contextTypes.forEach(type =>
        chrome.contextMenus.create({
            id: type,
            title: `Send this ${type} to Feishu`,
            contexts: [type === 'text' ? 'selection' : type]
        })
    );
    // Set default settings if not set
    const options = await getStorageData('options');
    if (!options || Object.keys(options).length === 0) {
        await setStorageData('options', defaultSettings);
    }
    // Open the embed view after the extension is installed
    if (details.reason === 'install') {
        chrome.tabs.create({ url: '/pages/embed.html' });
    }
});

// Get the tab URL from the context menu click event, including PDF viewer
const parseTabUrl = async (click, tabUrl) => {
    if (!tabUrl.startsWith('http') && click.frameUrl.includes('.pdf')) {
        return click.frameUrl;
    }
    return tabUrl;
};

// Build the content data object by context menu click event and tab URL
const buildContentData = async (click, tabUrl) => {
    switch (click.menuItemId) {
        case 'text':
            return { text: click.selectionText, tabUrl };
        case 'link':
            return { linkUrl: click.linkUrl, tabUrl };
        case 'page':
            return { pageUrl: tabUrl };
        case 'image':
            return { srcUrl: click.srcUrl, tabUrl };
        default:
            return false;
    }
};

// Listen for content from context menu and trigger sendMessage function
chrome.contextMenus.onClicked.addListener(async (click, tab) => {
    if (!contextTypes.includes(click.menuItemId)) {
        return false;
    }
    const options = await getStorageData('options');
    const messageType = click.menuItemId;
    const tabUrl = await parseTabUrl(click, tab.url);
    const messageData = await buildContentData(click, tabUrl);
    await sendMessage(messageData, messageType, tab);
});

// Listen for connection status information request from homepage
chrome.runtime.onMessage.addListener(async request => {
    if (request.message === 'getConnectionStatus') {
        const options = await getStorageData('options');

        const appToken = options.connections.setup[options.connections.use].key;
        if (!appToken) {
            return await chrome.runtime.sendMessage({
                message: 'returnConnectionStatus',
                data: { code: 400, msg: 'No token was provided.' }
            });
        }

        const requestURL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
        const getToken = await fetchAPI(requestURL, {
            app_id: options.connections.setup[options.connections.use].appId,
            app_secret: appToken
        });

        return await chrome.runtime.sendMessage({
            message: 'returnConnectionStatus',
            data: await getToken.json(),
        });
    }
});

// Function to check if given URL is valid
const isValidURL = function (string) {
    let url;
    try {
        url = new URL(string);
    } catch (_) {
        return false;
    }
    return url.protocol === 'http:' || url.protocol === 'https:';
};

// Build the Feishu API request URL
const buildRequestURL = function () {
    return 'https://open.feishu.cn/open-apis/im/v1/messages';
};

// Build the message content object by message type
const buildContentByType = function (type, content) {
    switch (type) {
        case 'text':
            return { msg_type: 'text', content: JSON.stringify({ text: content.text }) };
        case 'link':
        case 'page':
            return { msg_type: 'text', content: JSON.stringify({ text: content.linkUrl || content.pageUrl }) };
        case 'image':
            return { msg_type: 'image', content: JSON.stringify({ image_key: content.srcUrl }) };
        default:
            return false;
    }
};

// Build the request parameters object by message type and user settings
const buildPostData = function (type, content, options) {
    if (!messageTypes.includes(type)) {
        throw new Error(`Unrecognized message type: ${type}`);
    }

    const parameters = {
        receive_id: options.connections.setup[options.connections.use].chatId,
        ...buildContentByType(type, content)
    };

    return parameters;
};

// Make HTTP requests using Fetch API
const fetchAPI = async function (url, postData) {
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${await getTenantAccessToken()}`
        },
        body: JSON.stringify(postData)
    };
    try {
        return await fetch(url, options);
    } catch (error) {
        return JSON.stringify({ code: 500, msg: `Error while sending the request: ${error}` });
    }
};

// Get tenant access token
const getTenantAccessToken = async function () {
    const options = await getStorageData('options');
    const url = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            app_id: options.connections.setup[options.connections.use].appId,
            app_secret: options.connections.setup[options.connections.use].key
        })
    });
    const data = await response.json();
    return data.tenant_access_token;
};

// Register the API response to the extension storage to use it later,
// and throw error with api response and stack trace if response is not ok
const handleAPIResponse = async function (data) {
    await setStorageData('lastAPIResponse', data);
    if (data.code === 0) {
        return true;
    }
    else {
        throw({
            status: data.code,
            description: data.msg,
            stackTrace: new Error()
        });
    }
};

// Register the message log to the extension storage to use it later,
// and increase the total message count if the message is sent successfully
const registerLog = async function (content, response, type) {
    let logs = await getStorageData('messageLogs');
    let total = await getStorageData('totalMessageCount');
    const options = await getStorageData('options');
    if (options.logs.active) {
        if (!logs) {
            await setStorageData('messageLogs', []);
            logs = [];
        }
        if (!total) {
            await setStorageData('totalMessageCount', 0);
            total = 0;
        }
        logs.unshift(buildLogObject(content, response, type, options));
        await setStorageData('messageLogs', logs);
    }
    if (response.code === 0) {
        await setStorageData('totalMessageCount', total + 1);
    }
};

// Build the log object by message type and user settings
const buildLogObject = function (content, response, type, options) {
    if (response.code !== 0) {
        return { type: type, content: false, errorLog: response, timestamp: Date.now(), status: 'fail' };
    }
    else if (options.logs.type === 'timestamp') {
        return { type: type, content: false, timestamp: Date.now(), status: 'success' };
    }
    else if (options.logs.type === 'everything') {
        return { type: type, content: content, timestamp: Date.now(), status: 'success' };
    }
    else {
        return false;
    }
};

// Show status badge on the extension's icon,
// and clear it after 1.5 seconds if the message is sent successfully
const handleBadgeText = async function (success) {
    if (typeof success !== 'boolean') {
        return false;
    }

    await chrome.action.setBadgeText({ text: success ? 'Sent' : 'Fail' });
    await chrome.action.setBadgeBackgroundColor({ color: success ? '#008000bd' : '#880024' });

    if (success) {
        setTimeout(async () => {
            await chrome.action.setBadgeText({ text: '' });
        }, 1500);
    }
};

// Send the message to Feishu API and handle the response
const sendMessage = async function (content, type, tab) {
    try {
        if (!content || !messageTypes.includes(type)) {
            throw new Error('sendMessage parameters are not valid!');
        }
        // Build the request parameters and message object
        const options = await getStorageData('options');
        const requestURL = buildRequestURL();
        const requestParameters = buildPostData(type, content, options);
        const activeAccount = options.connections.setup[options.connections.use];
        // Check if the App ID, App Secret and chat ID are set
        if (!activeAccount.appId || !activeAccount.key || !activeAccount.chatId) {
            return await handleAPIResponse({
                code: 400,
                msg: 'Please set up your Feishu app ID, app secret and chat ID to start sending messages.'
            });
        }
        // Send the request to Feishu API
        const sendRequest = await fetchAPI(requestURL, requestParameters);
        const response = await sendRequest.json();
        // Register the API response to the extension storage to use it later
        return await handleAPIResponse(response);
    } catch (error) {
        console.error('Error while sending the message: ', error);
        // TODO: Handle pre-message errors
    } finally {
        // Read the API response and then clear its value
        const apiResponse = await getStorageData('lastAPIResponse');
        await setStorageData('lastAPIResponse', {});
        // Show status badge on the extension's icon
        await handleBadgeText(apiResponse.code === 0);
        // If the browser is not in Incognito Mode, register the message log
        if (!tab.incognito) {
            await registerLog(content, apiResponse, type);
        }
    }
};