import { isPanelLanguage, panelLanguage, panelLanguageAt, panelLocale, panelText, setPanelLanguage } from "./panel/index.js";

const languageKey = "aifit-panel-language";
const hangul = /[가-힣]/;
const translated = ["placeholder", "aria-label", "title"];

const english = {
    "AI FIT 연동": "AI FIT Link",
    "처음으로": "Home",
    "목록": "List",
    "새로 받기": "Refresh",
    "기능 지표": "Function indicators",
    "기능 지표는 어디서 왔나요": "Where the function indicators come from",
    "이 앱의 이름": "Name in this app",
    "ICF 코드": "ICF code",
    "ICF 항목 이름": "ICF item title",
    "출처": "Source",
    "여섯 지표는 세계보건기구(WHO)의 국제기능장애건강분류(ICF)에 있는 항목이에요.": "The six indicators are items of the World Health Organization's International Classification of Functioning, Disability and Health (ICF).",
    "ICF는 2001년 5월 22일 제54차 세계보건총회에서 국제 표준으로 승인됐어요(결의 WHA54.21).": "The ICF was endorsed for international use by the 54th World Health Assembly on 22 May 2001 (resolution WHA54.21).",
    "우리나라는 통계청이 ICF를 바탕으로 한국표준건강분류(KCF)를 고시해 2018년부터 쓰고 있어요.": "In Korea, Statistics Korea issued the Korean Standard Classification of Functioning, Disability and Health (KCF), based on the ICF, in use since 2018.",
    "ICF에 원래 있는 것": "What the ICF contains",
    "ICF는 사람의 기능을 신체 기능(b), 신체 구조(s), 활동과 참여(d), 환경 요인(e)으로 나눠 이름과 뜻을 정해 둔 분류예요.": "The ICF classifies human functioning into body functions (b), body structures (s), activities and participation (d) and environmental factors (e), giving each item a name and a definition.",
    "그중 신체 기능은 정신 기능, 감각 기능과 통증, 음성과 말하기 기능, 심혈관·호흡 등의 기능, 소화·대사·내분비 기능, 비뇨생식 기능, 신경근골격과 운동 관련 기능, 피부 기능의 여덟 장으로 되어 있어요.": "Body functions have eight chapters: mental functions; sensory functions and pain; voice and speech functions; functions of the cardiovascular, haematological, immunological and respiratory systems; functions of the digestive, metabolic and endocrine systems; genitourinary and reproductive functions; neuromusculoskeletal and movement-related functions; and functions of the skin and related structures.",
    "그중에서 고른 여섯 항목": "The six items chosen",
    "움직임 놀이에서 아이의 수행으로 관찰할 수 있는 항목을 골랐어요. 정신 기능 장(b1)에서 다섯, 신경근골격과 운동 관련 기능 장(b7)에서 하나예요.": "We chose the items that can be observed in a child's performance during movement play: five from the mental functions chapter (b1) and one from the neuromusculoskeletal and movement-related functions chapter (b7).",
    "감각, 말하기, 심폐 기능처럼 이 게임들이 관찰할 수 없는 항목은 넣지 않았어요.": "Items these games cannot observe, such as sensory, speech or cardiorespiratory functions, are not included.",
    "값이 나오는 방법": "How the values are made",
    "ICF는 기능의 이름과 뜻을 정한 분류예요. 0~100 값은 그 뜻에 맞춰 게임들이 놀이 중 수행을 관찰해 계산해요.": "The ICF defines the names and meanings of functions. The 0–100 values are calculated by the games, following those meanings, from the performance they observe during play.",
    "게임은 그 기능이 필요한 순간마다 해낸 정도와 그때의 어려운 정도를 함께 봐요. 가장 쉬운 조건에서 다 해내면 40, 가장 어려운 조건에서 다 해내면 100이에요.": "For every moment that needs the function, a game looks at how well it was done and how hard the condition was. Doing everything under the easiest condition gives 40, under the hardest condition 100.",
    "여러 게임의 값은 관찰이 많고 최근인 게임에 더 무게를 두어 합쳐요. 지표 줄을 누르면 게임별 값과 관찰 횟수가 보여요.": "Values from several games are combined with more weight on games with more and more recent observations. Press an indicator to see each game's value and number of observations.",
    "자료: WHO, International Classification of Functioning, Disability and Health (2001) · 통계청, 한국표준건강분류(KCF)": "Sources: WHO, International Classification of Functioning, Disability and Health (2001) · Statistics Korea, Korean Standard Classification of Functioning, Disability and Health (KCF)",
    "자료 없음": "No data",
    "자료 부족": "Little data",
    "{game} · {value} · 관찰 {samples}회 · {time}": "{game} · {value} · {samples} observations · {time}",
    "높을 때: {text}": "When high: {text}",
    "낮을 때: {text}": "When low: {text}",
    "이 지표를 보낸 게임이 아직 없어요.": "No game has sent this indicator yet.",
    "프로필": "Profiles",
    "프로필 만들기": "Add a profile",
    "프로필 이름 (아이 이름 또는 별명)": "Profile name (child's name or nickname)",
    "예: 민지": "e.g. Minji",
    "만들기": "Create",
    "취소": "Cancel",
    "여기서 만든 프로필은 연동한 모든 게임에 같은 이름으로 생겨요. 프로필을 만들고 지우는 건 이 앱에서만 해요. 게임에서 만든 프로필은 그 게임에만 있어요.": "A profile made here appears with the same name in every linked game. Profiles are made and deleted only in this app. A profile made in a game stays in that game.",
    "연동한 게임": "Linked games",
    "게임 연동하기": "Link a game",
    "연동하는 법": "How to link",
    "게임의 설정 화면에서 {a} → {b}를 눌러요.": "In the game's settings, press {a} → {b}.",
    "태블릿 연동": "Tablet link",
    "연동 번호 받기": "Get a link number",
    "이 앱에서 {a}를 누르고 게임 화면의 QR을 찍으면 바로 연동돼요.": "In this app, press {a} and scan the QR code on the game screen. That links at once.",
    "카메라를 못 쓰면 8자리 번호를 넣고, 두 화면의 확인 번호 4자리가 같을 때 게임에서 {a}을 눌러요.": "If you cannot use the camera, enter the 8-digit number, and press {a} in the game when the 4-digit confirm numbers on both screens match.",
    "QR 찍어서 연동하기": "Scan the QR code to link",
    "이 주소에서는 카메라를 쓸 수 없어요. 아래에 번호를 넣어 주세요.": "The camera cannot be used at this address. Please enter the number below.",
    "게임 화면의 연동 QR을 네모 안에 비춰 주세요.": "Point the camera at the link QR code on the game screen so it sits in the square.",
    "카메라 끄기": "Turn the camera off",
    "또는 번호로": "or with the number",
    "번호로 연동하기": "Link with the number",
    "카메라를 켜지 못했어요. 카메라 사용을 허락하거나 아래에 번호를 넣어 주세요.": "Could not turn the camera on. Allow the camera, or enter the number below.",
    "연동 QR이 아니에요. 게임 설정의 태블릿 연동에 나오는 QR을 비춰 주세요.": "That is not a link QR code. Point at the QR code shown under Tablet link in the game settings.",
    "QR을 읽었어요. 게임과 연동하는 중이에요…": "QR code read. Linking with the game…",
    "연동": "Link",
    "두 기기가 인터넷에 연결돼 있거나 같은 공유기에 있으면 돼요. 기록과 설정은 게임이 켜져 있을 때 받아 와요. 여기서 고른 언어는 연동한 게임에도 같이 적용돼요.": "Both devices need the internet or the same router. Records and settings come in while the game is running. The language chosen here is applied to the linked games too.",
    "게임 화면의 8자리 연동 번호": "8-digit link number on the game screen",
    "이 태블릿 이름": "This tablet's name",
    "예: 3반 선생님 태블릿": "e.g. Class 3 teacher's tablet",
    "인터넷이 안 될 때 (같은 공유기)": "No internet (same router)",
    "게임 주소": "Game address",
    "예: 192.168.0.12:47811": "e.g. 192.168.0.12:47811",
    "게임 설정의 태블릿 연동 아래에 나오는 같은 공유기 주소를 넣어요.": "Enter the same-router address shown under Tablet link in the game settings.",
    "게임 화면의 확인 번호가 아래와 같은지 보고, 같으면 {a}을 눌러 주세요.": "Check that the confirm number on the game screen matches the one below. If it does, press {a}.",
    "게임에서 연동": "Link in the game",
    "이름 바꾸기": "Rename",
    "프로필 지우기": "Delete profile",
    "새 이름": "New name",
    "바꾸기": "Rename",
    "바뀐 이름은 연동한 모든 게임에 전해져요.": "The new name is passed to every linked game.",
    "아직 연동한 게임이 없어요. 처음 화면에서 게임을 연동하면 이 프로필의 기록이 게임마다 보여요.": "No linked games yet. Link a game from the home screen to see this profile's records for each game.",
    "이름 찾기": "Find a name",
    "연동 해제": "Unlink",
    "게임 화면 보기": "Watch the game screen",
    "화면 보기": "Watch screen",
    "같은 공유기로 직접 연결돼 있어요": "Connected directly over the same router",
    "인터넷 중계로 연결돼 있어요": "Connected through the internet relay",
    "게임 화면은 태블릿과 게임 PC가 같은 공유기(와이파이)에 있을 때만 볼 수 있어요.": "The game screen can be watched only while the tablet and the game PC are on the same router (Wi-Fi).",
    "웹 주소에서는 게임 화면을 볼 수 없어요. 같은 공유기에서 설치형 앱으로 열면 볼 수 있어요.": "The game screen cannot be watched from the web address. Open the installed app on the same router to watch it.",
    "닫기": "Close",
    "누르기 켬": "Tapping on",
    "누르기 끔": "Tapping off",
    "게임 화면을 여는 중이에요…": "Opening the game screen…",
    "같은 공유기로 보는 중 · 초당 {fps}장 · 화면을 누르면 게임에서 눌려요": "Watching over the same router · {fps} frames/s · tapping the screen taps the game",
    "같은 공유기로 보는 중 · 초당 {fps}장 · 보기만 해요": "Watching over the same router · {fps} frames/s · view only",
    "게임 화면을 아직 받을 수 없어요. 게임 창이 내려가 있으면 올려 주세요.": "The game screen is not available yet. If the game window is minimized, restore it.",
    "게임 화면을 받지 못했어요. 태블릿과 게임 PC가 같은 공유기에 있는지 확인해 주세요.": "Could not get the game screen. Check that the tablet and the game PC are on the same router.",
    "게임이 이 태블릿을 알아보지 못해요. 연동을 다시 확인해 주세요.": "The game does not recognize this tablet. Please check the link.",
    "게임 화면 보기는 같은 공유기에서 설치형 앱이나 게임 PC의 '이 컴퓨터에서 앱 열기'로만 돼요.": "Watching the game screen works only on the same router, in the installed app or with 'Open the app on this computer' on the game PC.",
    "언어": "Language",
    "언어 · Language": "Language",
    "연동 {time}": "Linked {time}",
    "마지막으로 받음 {time}": "Last received {time}",
    "켜져 있어요": "Running",
    "꺼져 있어요": "Not running",
    "켜져 있는지 확인 중이에요": "Checking whether it is running",
    "아직 프로필이 없어요. '프로필 만들기'로 만들면 연동한 게임마다 같은 프로필이 생겨요.": "No profiles yet. Use 'Add a profile' and the same profile appears in every linked game.",
    "아직 연동한 게임이 없어요. '게임 연동하기'로 시작해요.": "No linked games yet. Start with 'Link a game'.",
    "아직 게임에 없어요": "Not in any game yet",
    "게임 {count}개에 있어요": "In {count} game(s)",
    "게임 연동": "Link a game",
    "전체": "All",
    "보여 줄 내용이 없어요.": "Nothing to show.",
    "바뀐 값 {count}개": "Changed: {count}",
    "게임에 보내는 중이에요…": "Sending to the game…",
    "보냈어요.": "Sent.",
    "태블릿": "Tablet",
    "적용했어요.": "Applied.",
    "{message} 바꾼 값은 아직 이 화면에만 있어요.": "{message} Your changes are still only on this screen.",
    "{message} 아래는 방금 새로 받은 값이에요.": "{message} Below are the values just received.",
    "{time}에 받음": "Received {time}",
    "게임에서 받는 중이에요…": "Getting it from the game…",
    "{message} 아래는 {time}에 받은 기록이에요.": "{message} Below are the records received at {time}.",
    "답하지 않은 게임이 있어요 — {list}": "Some games did not answer — {list}",
    "이 게임에는 아직 없어요. 게임이 켜져 있을 때 새로 받으면 이 프로필이 만들어져요.": "Not in this game yet. Refresh while the game is on and this profile is made there.",
    "이 게임에 만들기": "Create in this game",
    "'{name}'을(를) '{game}'에 만드는 중이에요…": "Creating '{name}' in '{game}'…",
    "'{name}'을(를) '{game}'에 만들었어요.": "Created '{name}' in '{game}'.",
    "'{game}'이(가) '{name}'을(를) 만들지 않았어요. 게임의 프로필이 가득 찼거나 게임이 옛 연동 모듈일 수 있어요.": "'{game}' did not create '{name}'. The game's profiles may be full, or the game may use an old link module.",
    "'{name}'을(를) 만들지 못한 게임이 있어요 — {list}. 게임 칸의 '이 게임에 만들기'로 다시 해 보세요.": "Some games did not create '{name}' — {list}. Try again with 'Create in this game' in that game's section.",
    "아직 받지 않았어요": "Not received yet",
    "받는 중이에요…": "Loading…",
    "'{name}'을(를) 게임에 만드는 중이에요…": "Creating '{name}' in the games…",
    "바뀐 이름을 게임에 전하는 중이에요…": "Passing the new name to the games…",
    "바뀐 언어를 게임에 전하는 중이에요…": "Passing the new language to the games…",
    "프로필 이름을 1~20자로 적어 주세요.": "Enter a profile name of 1 to 20 characters.",
    "같은 이름의 프로필이 이미 있어요.": "A profile with this name already exists.",
    "한 번 더 누르면 지워요": "Press again to remove",
    "연동한 모든 게임에서 이 프로필과 그 기록이 지워져요. 지우려면 한 번 더 눌러요.": "This profile and its records will be deleted from every linked game. Press again to delete.",
    "'{name}'을(를) 게임에서 지우는 중이에요…": "Deleting '{name}' from the games…",
    "게임 화면의 8자리 연동 번호를 넣어 주세요.": "Enter the 8-digit link number shown on the game screen.",
    "게임 주소를 다시 확인해 주세요. 예: 192.168.0.12:47811": "Please check the game address. e.g. 192.168.0.12:47811",
    "게임을 찾는 중이에요…": "Looking for the game…",
    "게임에서 연동을 누르면 끝나요.": "Done once Link is pressed in the game.",
    "'{name}' 연동을 해제할까요? 게임에서도 이 태블릿이 빠지고, 이 태블릿의 프로필은 그 게임에 더 이상 보이지 않아요. 프로필은 이 태블릿에 그대로 있고, 다시 연동하면 게임에 다시 보여요.": "Unlink '{name}'? This tablet also leaves the game, and this tablet's profiles no longer show in that game. The profiles stay on this tablet and show in the game again when you link again.",
    "'{name}' 게임이 꺼졌어요. 다시 켜면 저절로 새로 받아요.": "'{name}' was closed. It refreshes by itself when the game starts again.",
    "'{name}'에서 이 태블릿의 연동을 해제했어요. 프로필은 이 태블릿에 그대로 있어요.": "'{name}' unlinked this tablet. The profiles stay on this tablet.",
    "앱 {version}": "App {version}",
    "지금 게임": "Now playing",
    "게임에서 값이 바뀌었어요. 고치던 값을 적용하거나 되돌리면 새 값을 받아요.": "Something changed in the game. Apply or undo your edits to get the new values.",
    "웹 주소에서는 인터넷 중계로만 연결돼요. 게임 PC도 인터넷에 있어야 해요. 같은 공유기 직접 연결은 설치형 앱이나 게임 PC의 '이 컴퓨터에서 앱 열기'로 해요.": "From a web address the link goes through the internet relay only, so the game PC needs the internet too. For a same-router link use the installed app or 'Open the app on this computer' on the game PC.",
    "이 주소로는 연동 암호화를 쓸 수 없어요. 아이핏 PC에서는 게임 설정의 '이 컴퓨터에서 앱 열기'로, 다른 기기는 설치형 앱이나 https 주소로 열어 주세요.": "Link encryption is not available at this address. On the AI FIT PC use 'Open the app on this computer' in the game settings; on other devices use the installed app or an https address."
};

const isTime = (value) => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));

const storedLanguage = () =>
{
    try
    {
        const raw = localStorage.getItem(languageKey);
        const stored = raw === null ? null : JSON.parse(raw);
        if (isPanelLanguage(stored)) return { id: stored, at: null };
        if (stored !== null && typeof stored === "object" && isPanelLanguage(stored.id)) return { id: stored.id, at: isTime(stored.at) ? stored.at : null };
    }
    catch
    {
    }
    return { id: (navigator.language ?? "ko").toLowerCase().startsWith("ko") ? "ko" : "en", at: null };
};

const saveLanguage = (id, at) =>
{
    try
    {
        localStorage.setItem(languageKey, JSON.stringify({ id, at }));
        return true;
    }
    catch
    {
        return false;
    }
};

export const appText = (text, values = {}) => panelLanguage() === "en" && Object.hasOwn(english, text) ? panelText(english[text], values) : panelText(text, values);
export const appLocale = panelLocale;
export const appEnglish = Object.freeze({ ...english });

const escapeText = (value) => String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

export const translatePage = (root = document) =>
{
    if (panelLanguage() === "ko") return;
    for (const element of root.querySelectorAll("[data-text]"))
    {
        const values = Object.fromEntries(["a", "b"].filter((name) => element.dataset[name] !== undefined).map((name) => [name, `<b>${escapeText(appText(element.dataset[name]))}</b>`]));
        element.innerHTML = escapeText(appText(element.dataset.text)).replace(/\{(\w+)\}/g, (whole, name) => values[name] ?? whole);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
    {
        const text = node.nodeValue ?? "";
        const key = text.replace(/\s+/g, " ").trim();
        if (hangul.test(key)) node.nodeValue = text.replace(text.trim(), appText(key));
    }
    for (const element of root.querySelectorAll("*"))
        for (const name of translated)
        {
            const value = element.getAttribute(name);
            if (value !== null && hangul.test(value)) element.setAttribute(name, appText(value));
        }
};

export const startLanguage = () =>
{
    const stored = storedLanguage();
    setPanelLanguage(stored.id, stored.at);
    document.documentElement.lang = panelLanguage();
    document.title = appText("AI FIT 연동");
};

export const adoptGameLanguage = (language) =>
{
    if (language === null || typeof language !== "object" || !isPanelLanguage(language.id) || !isTime(language.at)) return false;
    const mine = panelLanguageAt();
    if (mine !== null && Date.parse(language.at) <= Date.parse(mine)) return false;
    const switching = language.id !== panelLanguage();
    if (!saveLanguage(language.id, language.at)) return false;
    setPanelLanguage(language.id, language.at);
    if (switching) location.reload();
    return switching;
};

export const languagePicker = (select, before = () => Promise.resolve()) =>
{
    select.value = panelLanguage();
    select.addEventListener("change", () =>
    {
        const next = select.value;
        if (!isPanelLanguage(next) || next === panelLanguage()) return;
        const at = new Date().toISOString();
        if (!saveLanguage(next, at))
        {
            select.value = panelLanguage();
            return;
        }
        setPanelLanguage(next, at);
        select.disabled = true;
        Promise.resolve().then(before).catch(() => undefined).then(() => location.reload());
    });
};
