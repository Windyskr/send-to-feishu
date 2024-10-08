import { getStorageData } from '../../utils/storage.js';
import { timestampToReadableDate } from '../../utils/date.js';

(async () => {
    const hideWizard = await getStorageData('hideWizard');
    if (!hideWizard) {
        document.querySelector('body').style.display = 'none';
        window.location.replace('/pages/wizard.html');
    }
})();

const removeExtensionBadge = async () => {
    await chrome.action.setBadgeText({ text: '' });
};

const highlightLogsButton = () => {
    const logsButton = document.querySelector('.nav-logs-btn.tooltip');
    const logsTooltipText = document.querySelector('.nav-logs-btn .tooltiptext');
    logsButton.style.backgroundColor = '#8b000024';
    logsTooltipText.style.visibility = 'visible';
    logsTooltipText.style.opacity = '1';
};

const handleMessageError = async () => {
    const badgeText = await chrome.action.getBadgeText({});
    if (badgeText !== 'Fail') {
        return true;
    }

    await removeExtensionBadge();
    highlightLogsButton();
};

const uppercaseFirstLetter = (str) => {
    return str[0].toUpperCase() + str.slice(1);
};

const getLastMessageByStatus = async status => {
    const logs = await getStorageData('messageLogs');
    const firstOfType = logs && logs.find(log => log.status === status);
    if (firstOfType) {
        const modifiedType = firstOfType.type === 'document' ? 'file' : firstOfType.type;
        return `• ${uppercaseFirstLetter(modifiedType)} at ${timestampToReadableDate(firstOfType.timestamp)}`;
    } else {
        return '• No messages yet.';
    }
};

const handleStatistics = async () => {
    const totalSent = await getStorageData('totalMessageCount');
    if (totalSent === 1) {
        document.getElementById('message-word').innerText = 'message';
    }
    document.getElementById('total-message-count').innerText = totalSent || 0;
    ['success', 'fail'].map(
        async status => document.getElementById(`last-${status}-message`).textContent = await getLastMessageByStatus(status)
    );
};

const addEmbedViewLink = () => {
    // Show the embed view link only if the page is not embedded
    if (window.self !== window.top) {
        return;
    }
    const template = document.getElementById('open-embed-view-template');
    const clone = template.content.cloneNode(true);
    document.querySelector('.main-header').appendChild(clone);
};

document.addEventListener('DOMContentLoaded', async () => {
    await initializeStatusMessage();
    await handleStatistics();
    await handleMessageError();
    addEmbedViewLink();
});

const removeBlinkerAfterDelay = delay => {
    setTimeout(() => {
        [...document.querySelectorAll('.dot')].forEach((element, index) => {
            if (index !== 0) {
                element.remove();
            }
            element.classList.remove('blink-one');
        });
    }, delay);
};

const updateStatusAfterDelay = (status, delay) => {
    removeBlinkerAfterDelay(delay);
    setTimeout(() => {
        document.querySelector('.dot').classList.remove('gray-dot');
        document.querySelector('.dot').classList.add(status ? 'green-dot' : 'red-dot');
        document.getElementById('connection-message').innerText = `Connection${status ? '' : ' not'} established`;
    }, delay);
};

const initializeStatusMessage = async () => {
    const isWizardHidden = await getStorageData('hideWizard');
    if (isWizardHidden) {
        await chrome.runtime.sendMessage({
            message: 'getConnectionStatus'
        });
    }
};

chrome.runtime.onMessage.addListener(function (request) {
    if (request.message === 'returnConnectionStatus') {
        updateStatusAfterDelay(request?.data?.code === 0, 600);
    }
});