import { defaultSettings, messageTypes } from "./options.js";
import { getStorageData, setStorageData } from "./handlers/storage.js";

//Add context menu items and set default settings on install
const contextTypes = ['text', 'link', 'page', 'image'];
chrome.runtime.onInstalled.addListener(async () => {
    contextTypes.forEach(type =>
        chrome.contextMenus.create({
            id: type,
            title: `Send this ${type} to Telegram`,
            contexts: [type === 'text' ? 'selection' : type]
        })
    );
    //Set default settings if not set
    const options = await getStorageData('options');
    if (!options || Object.keys(options).length === 0) await setStorageData('options', defaultSettings);
});
const getCurrentTab = async () => await chrome.tabs.query({active: true, currentWindow: true});

const contextMenuHandler = async (click) => {
    const [{ url: tabUrl }] = await getCurrentTab();
    switch (click.menuItemId) {
        case 'text':
            return await getSelectedText();
        case 'link':
            return { linkUrl: click.linkUrl, tabUrl };
        case 'page':
            return { pageUrl: tabUrl, tabUrl };
        case 'image':
            return { srcUrl: click.srcUrl, tabUrl };
        default:
            return false;
    }
}

//add listener for click on self defined menu item
chrome.contextMenus.onClicked.addListener(async click => {
    if (!contextTypes.includes(click.menuItemId)) return false;

    const options = await getStorageData('options');
    const messageType = click.menuItemId !== 'image' ? click.menuItemId : options.actions.sendImage.sendAs;
    const messageData = await contextMenuHandler(click);
    await sendMessage(messageData, messageType);
});

chrome.runtime.onMessage.addListener(async request => {
    if (request.message === 'getConnectionStatus') {
        const options = await getStorageData('options');
        const getMe = await fetchAPI(buildRequestURL('me', options), buildPostData('me', {}, options));
        await chrome.runtime.sendMessage({
            message: "returnConnectionStatus",
            data: await getMe.json(),
        });
    }
});

//to get a string which supports line breaks, use script execution on the page
const getSelectedText = async function () {
    const [currentTab] = await getCurrentTab();
    let result;
    try {
        [{result}] = await chrome.scripting.executeScript({
            target: {tabId: currentTab.id},
            function: () => getSelection().toString()
            // validating the string can be vital
            // calculate the length (consider the reply markups)
        });
    } catch (e) {
        console.log(e);
        return; // ignoring an unsupported page like chrome://extensions
    }
    //document.body.append('Selection: ' + result);
    return { text: result, tabUrl: currentTab.url };
}

//Function to check if given URL is valid
//Author @Pavlo https://stackoverflow.com/a/43467144
const isValidURL = function (string) {
    let url;
    try {
        url = new URL(string);
    } catch (_) {
        return false;
    }
    return url.protocol === "http:" || url.protocol === "https:";
}

// See if this scalable
const getMessageType = function (type) {
    switch (type) {
        case 'text':
        case 'link':
        case 'page':
            return '/sendMessage';
        case 'photo':
            return '/sendPhoto';
        case 'document':
            return '/sendDocument'
        case 'me':
            return '/getMe'
        default:
            return false;
    }
}

const buildRequestURL = function (type, options) {
    return 'https://api.telegram.org/bot' + options.connections.setup[options.connections.use].key + getMessageType(type);
}

const buildContentByType = function (type, content) {

    switch (type) {
        case 'text':
            return {type: 'text', content: content.text};
        case 'link':
            return {type: 'text', content: content.linkUrl};
        case 'page':
            return {type: 'text', content: content.pageUrl};
        case 'photo':
            return {type: 'photo', content: content.srcUrl};
        case 'document':
            return {type: 'document', content: content.srcUrl};
        default:
            return false;
    }

}

const buildPostData = function (type, content, options) {

    if (!messageTypes.includes(type)) return false;
    if (type === 'me') return {};

    const parameters = {
        chat_id: options.connections.setup[options.connections.use].chatId,
    };

    const typeKey = `send${['photo', 'document'].includes(type) ? 'Image' : 'Message'}`;
    parameters.disable_notification = options.actions[typeKey].disableNotificationSound;
    parameters.disable_web_page_preview = options.actions[typeKey].disablePreview;
    const addSourceLink = options.actions[typeKey].addSourceLink;

    const userContent = buildContentByType(type, content);
    parameters[userContent['type']] = userContent['content'];

    if (addSourceLink && isValidURL(content.tabUrl) && type !== 'page') {
        parameters.reply_markup = {
            inline_keyboard: [
                [{ text: 'Source', url: content.tabUrl }]
            ],
        }
    }

    return parameters;
}

const fetchAPI = async function (url, postData) {
    const options = {
        method: 'POST',
        headers: {
            "Content-Type": "application/json"
        },
        body: postData ? JSON.stringify(postData) : undefined
    };
    return await fetch(url, options);
}

const handleAPIResponse = async function (data) {
    await setStorageData('lastAPIResponse', data);
    if (data.ok) return true;
    else {
        throw({
            status: data['error_code'],
            description: data.description,
            stackTrace: new Error()
        });
    }
}

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
    if (response.ok) {
        await setStorageData('totalMessageCount', total + 1);
    }
}

const buildLogObject = function (content, response, type, options) {
    console.log(response);
    if (!response.ok) {
        return { type: type, content: content, timestamp: Date.now(), status: 'fail' };
    }
    else if (options.logs.type === 'timestamp') {
        return { type: type, content: false, timestamp: Date.now(), status: 'success' };
    }
    else if (options.logs.type === 'everything') {
        const contentObject = ['photo', 'document'].includes(type) ? {
            ...content,
            fileID: type === 'photo' ? response.result[type][0]['file_id'] : response.result[type]['file_id'],
            uniqueID: type === 'photo' ? response.result[type][0]['file_unique_id'] : response.result[type]['file_unique_id']
        } : content;
        return { type: type, content: contentObject, timestamp: Date.now(), status: 'success' };
    }
    else {
        return false;
    }
}

const handleBadgeText = async function (success) {
    if (typeof success !== "boolean") return false;

    await chrome.action.setBadgeText({ text: success ? 'Sent' : 'Fail' });
    await chrome.action.setBadgeBackgroundColor({ color: success ? '#008000bd' : '#880024' });

    if (success) {
        setTimeout(async () => {
            await chrome.action.setBadgeText({ text: '' })
        }, 1500);
    }
}

const sendMessage = async function (content, type) {
    try {
        if (typeof content === 'undefined' || !messageTypes.includes(type)) {
            throw new Error('sendMessage parameters are not valid!');
        }
        // Build the request parameters and message object
        const options = await getStorageData('options');
        const requestURL = buildRequestURL(type, options);
        const requestParameters = buildPostData(type, content, options);
        // Send the request to Telegram Bot API
        const sendRequest = await fetchAPI(requestURL, requestParameters);
        const response = await sendRequest.json();
        // Register the API response to the browser storage to use it later
        return await handleAPIResponse(response);
    } catch (error) {
        console.error('Error while sending the message: ', error);
    } finally {
        // Read the API response and then clear its value
        const apiResponse = await getStorageData('lastAPIResponse');
        await setStorageData('lastAPIResponse', {});
        // Show status badge on the extension's icon and register the message log
        await handleBadgeText(apiResponse.ok);
        await registerLog(content, apiResponse, type);
    }
}
