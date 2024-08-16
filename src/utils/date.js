export const timestampToReadableDate = function (unixTimestamp, locale = 'en-US') {
    const date = new Date(unixTimestamp);
    return date.toLocaleString(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
};