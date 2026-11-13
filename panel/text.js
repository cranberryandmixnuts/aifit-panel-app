export const panelLanguages = Object.freeze(["ko", "en"]);

const english = {
    "아직 기록이 없어요.": "No records yet.",
    "기록 1개 {value}": "1 record {value}",
    "처음 {first} · 마지막 {last} · 가장 높음 {best}": "First {first} · last {last} · highest {best}",
    "추이": "Trend",
    "되돌리기": "Undo",
    "적용": "Apply",
    "이 앱에서 아직 못 보는 칸이에요. 앱을 새로 받아 주세요.": "This app cannot show this section yet. Please update the app.",
    "보여 줄 내용이 없어요.": "Nothing to show.",
    "태블릿": "Tablet",
    "게임": "Game",
    "이 게임은 아직 태블릿에서 바꾸기를 받지 않아요.": "This game does not accept changes from the tablet yet.",
    "적용했어요.": "Applied.",
    "게임 화면의 8자리 연동 번호를 넣어 주세요.": "Enter the 8-digit link number shown on the game screen.",
    "게임 화면의 연동 QR을 다시 찍어 주세요.": "Please scan the link QR code on the game screen again.",
    "게임을 찾지 못했어요. 번호가 맞는지, 두 기기가 인터넷이나 같은 공유기에 연결돼 있는지 확인해 주세요.": "Could not find the game. Check the number, and that both devices are on the internet or the same router.",
    "게임에서 연동을 거절했어요.": "The game denied the link.",
    "게임이 다른 태블릿과 연동하는 중이에요. 잠시 뒤 다시 해 주세요.": "The game is linking with another tablet. Please try again shortly.",
    "게임에서 연동을 누르지 않아 시간이 지났어요. 다시 해 주세요.": "Time ran out before Link was pressed in the game. Please try again.",
    "인터넷에 연결되지 않았어요. 연결을 확인해 주세요.": "Not connected to the internet. Please check the connection.",
    "바꿀 값을 다시 확인해 주세요.": "Please check the values to change.",
    "게임이 답하지 않아요. 게임이 켜져 있는지, 인터넷이나 같은 공유기에 연결돼 있는지 확인해 주세요.": "The game is not answering. Check that the game is running and on the internet or the same router.",
    "받은 기록을 읽지 못했어요. 앱과 게임을 새 버전으로 맞춰 주세요.": "Could not read the received records. Please update the app and the game.",
    "게임에서 기록을 만들지 못했어요.": "The game could not make the records.",
    "게임에서 이 태블릿의 연동을 해제했어요.": "The game unlinked this tablet."
};

let current = "ko";
let currentAt = null;

export const isPanelLanguage = (value) => panelLanguages.includes(value);
export const panelLanguage = () => current;
export const panelLanguageAt = () => currentAt;
export const setPanelLanguage = (value, at = null) =>
{
    current = isPanelLanguage(value) ? value : "ko";
    currentAt = typeof at === "string" && at.length <= 40 && !Number.isNaN(Date.parse(at)) ? at : null;
};
export const panelLocale = () => current === "en" ? "en-US" : "ko-KR";
export const panelText = (text, values = {}) =>
    (current === "en" ? english[text] ?? text : text).replace(/\{(\w+)\}/g, (whole, key) => Object.hasOwn(values, key) ? String(values[key]) : whole);
export const panelEnglish = Object.freeze({ ...english });
