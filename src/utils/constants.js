export const defaultSettings = {
    connections: {
        use: 0,
        setup: {
            0: {
                name: 'Default',
                appId: '',
                appSecret: '',
                chatId: ''
            }
        },
    },
    actions: {
        sendMessage: {
            disableNotificationSound: true,
            addSourceLink: true
        },
        sendImage: {
            disableNotificationSound: true,
            sendAs: 'image', // or 'file' - 'link'
            addSourceLink: true
        }
    },
    logs: {
        active: true,
        type: 'everything' // or 'timestamp'
    }
};

export const messageTypes = ['text', 'image', 'file', 'link', 'page'];

export const iconTypes = [...messageTypes, 'noLogs', 'tabUrl', 'deleteLog', 'success', 'success-bold', 'fail', 'calendar'];

export const apiBaseUrl = 'https://open.feishu.cn/open-apis/im/v1';