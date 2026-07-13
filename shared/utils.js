/**
 * Safe message sender that throws on backend errors
 */
async function safeSendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response && response.error) {
    throw new Error(response.error);
  }
  return response;
}
