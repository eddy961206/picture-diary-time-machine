import {
  buildSocialShareUrl,
  createImageFileFromDataUrl,
  createImageFilename,
  getSharePageUrl,
} from "./share-utils.js";
import { getSupabaseClient, getSupabaseConfig } from "./supabase-client.js?v=20260501-trial-save";
import {
  getSeoulDateKey,
  getStreakReward,
  getTodayRitualState,
  LOADING_LINES,
  MAX_DAILY_GENERATIONS,
  saveSuccessfulGeneration as recordSuccessfulGeneration,
  SHARE_LINES,
  writeRitualState,
} from "./ritual-state.js";

const form = document.querySelector("#diaryForm");
const diaryTextarea = form.elements.diary;
const textModeInputs = document.querySelectorAll("input[name='textMode']");
const photoInput = document.querySelector("#photo");
const photoPreviewWrap = document.querySelector("#photoPreviewWrap");
const photoPreview = document.querySelector("#photoPreview");
const clearPhoto = document.querySelector("#clearPhoto");
const generateBtn = document.querySelector("#generateBtn");
const eraserChance = document.querySelector("#eraserChance");
const resultImage = document.querySelector("#resultImage");
const loading = document.querySelector("#loading");
const loadingText = document.querySelector("#loadingText");
const downloadLink = document.querySelector("#downloadLink");
const copyShareText = document.querySelector("#copyShareText");
const log = document.querySelector("#log");
const socialShareButtons = document.querySelectorAll("[data-share-target]");
const stampButtons = document.querySelectorAll("[data-stamp]");
const quotaCard = document.querySelector("#quotaCard");
const quotaTitle = document.querySelector("#quotaTitle");
const quotaText = document.querySelector("#quotaText");
const quotaStatus = document.querySelector("#quotaStatus");
const streakTitle = document.querySelector("#streakTitle");
const streakText = document.querySelector("#streakText");
const stepWrite = document.querySelector("#stepWrite");
const stepGenerate = document.querySelector("#stepGenerate");
const stepSave = document.querySelector("#stepSave");
const authProviderBadge = document.querySelector("#authProviderBadge");
const authButtons = document.querySelectorAll("[data-auth-provider]");
const signOut = document.querySelector("#signOut");
const saveDiary = document.querySelector("#saveDiary");
const refreshDiary = document.querySelector("#refreshDiary");
const diaryList = document.querySelector("#diaryList");
const bookCard = document.querySelector("#bookCard");
const bookSelect = document.querySelector("#bookSelect");
const bookHint = document.querySelector("#bookHint");
const copyInviteCode = document.querySelector("#copyInviteCode");
const createBookForm = document.querySelector("#createBookForm");
const joinBookForm = document.querySelector("#joinBookForm");
const createBookButton = document.querySelector("#createBookButton");
const joinBookButton = document.querySelector("#joinBookButton");
const currentBookLabel = document.querySelector("#currentBookLabel");
const saveHint = document.querySelector("#saveHint");
const saveLoginModal = document.querySelector("#saveLoginModal");
const closeSaveLoginModal = document.querySelector("#closeSaveLoginModal");

const PENDING_SAVE_DB = "pictureDiaryPendingSave:v1";
const PENDING_SAVE_STORE = "pending";
const PENDING_SAVE_KEY = "latest";
let restoringPendingSave = false;

let referenceImageDataUrl = "";
let currentImageUrl = resultImage.getAttribute("src") || "/sample-output.png";
let currentImageFormat = "png";
let currentImageFilename = createImageFilename(currentImageFormat);
let supabase = null;
let currentUser = null;
let diaryBooks = [];
let currentBookId = "";
let lastGeneratedInput = null;
let currentStamp = "";


function formData() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.referenceImageDataUrl = referenceImageDataUrl;
  data.size = "1024x1536";
  data.quality = "medium";
  data.outputFormat = "png";
  return data;
}

function validateRequiredInputs() {
  if (String(diaryTextarea.value || "").trim()) return true;
  diaryTextarea.reportValidity();
  setLog("오늘 있었던 일을 한 줄만 적어주세요.", "error");
  return false;
}

function currentTextMode() {
  return form.elements.textMode?.value === "exact" ? "exact" : "expand";
}

function updateTextModeUi() {
  const exactMode = currentTextMode() === "exact";
  diaryTextarea.placeholder = exactMode
    ? "예: 오늘은 회사에서 일이 많았다.\n집에 오면서 라면을 먹었다.\n조금 피곤했지만 맛있었다."
    : "한 줄만 적어도 알아서 일기장 문장으로 만들어줄게요.";
}

function setLog(message, tone = "normal") {
  if (!log) return;
  log.textContent = message || "";
  log.dataset.tone = tone;
}

function maxGenerationsForCurrentUser() {
  return currentUser ? MAX_DAILY_GENERATIONS : 1;
}

function openPendingDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PENDING_SAVE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(PENDING_SAVE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writePendingSave(payload) {
  const db = await openPendingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_SAVE_STORE, "readwrite");
    tx.objectStore(PENDING_SAVE_STORE).put(payload, PENDING_SAVE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readPendingSave() {
  const db = await openPendingDb();
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_SAVE_STORE, "readonly");
    const request = tx.objectStore(PENDING_SAVE_STORE).get(PENDING_SAVE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

async function clearPendingSave() {
  const db = await openPendingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_SAVE_STORE, "readwrite");
    tx.objectStore(PENDING_SAVE_STORE).delete(PENDING_SAVE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function setFormControlsDisabled(targetForm, disabled) {
  targetForm?.querySelectorAll("input, button").forEach((control) => {
    control.disabled = disabled;
  });
}

function setStep(activeStep) {
  [
    [stepWrite, "write"],
    [stepGenerate, "generate"],
    [stepSave, "save"],
  ].forEach(([element, step]) => {
    element?.classList.toggle("active", step === activeStep);
    element?.classList.toggle("done", step !== activeStep && (
      (activeStep === "generate" && step === "write")
      || (activeStep === "save" && step !== "save")
    ));
  });
}

function updateSaveHint() {
  if (!saveHint) return;
  if (currentImageUrl.startsWith("data:")) {
    const book = selectedBook();
    saveHint.textContent = book
      ? `"${book.name}"에 붙일 준비가 됐어요.`
      : "일기장에 붙일 준비가 됐어요.";
  } else {
    saveHint.textContent = "아직 붙일 그림일기가 없어요.";
  }
}

function remainingGenerations() {
  const state = getTodayRitualState();
  return Math.max(0, maxGenerationsForCurrentUser() - state.generations);
}

function updateRitualUi() {
  const state = getTodayRitualState();
  writeRitualState(state);
  const remaining = Math.max(0, maxGenerationsForCurrentUser() - state.generations);
  const needsLogin = Boolean(supabase && !currentUser);
  const locked = remaining <= 0;
  const hasUsedFirst = state.generations > 0;

  if (!currentUser) {
    quotaTitle.textContent = remaining > 0 ? "체험으로 한 장 만들기" : "체험 완료";
    quotaText.textContent = remaining > 0 ? "먼저 한 장 만들어볼 수 있어요." : "더 만들려면 일기장에 붙여주세요.";
    quotaStatus.textContent = remaining > 0 ? "1번 가능" : "완료";
  } else if (state.generations === 0) {
    quotaTitle.textContent = "오늘의 일기장";
    quotaText.textContent = "오늘은 두 장까지 만들 수 있어요.";
    quotaStatus.textContent = "2번 가능";
  } else if (state.generations === 1) {
    quotaTitle.textContent = "지우개 찬스!";
    quotaText.textContent = "한 번 더 만들 수 있어요.";
    quotaStatus.textContent = "1번 가능";
  } else {
    quotaTitle.textContent = "오늘은 여기까지";
    quotaText.textContent = "내일 다시 만들 수 있어요.";
    quotaStatus.textContent = "완료";
  }

  quotaCard.dataset.state = needsLogin ? "login" : locked ? "locked" : hasUsedFirst ? "eraser" : "ready";
  generateBtn.disabled = locked;
  generateBtn.textContent = hasUsedFirst ? "다시 만들기" : "그림일기 만들기";
  eraserChance.classList.toggle("hidden", !hasUsedFirst || locked);
  eraserChance.disabled = locked;
  diaryTextarea.disabled = locked;
  photoInput.disabled = locked;
  textModeInputs.forEach((input) => { input.disabled = locked; });
  form.querySelectorAll("input[name='moodType']").forEach((input) => { input.disabled = locked; });

  streakTitle.textContent = getStreakReward(state.streak);
  streakText.textContent = state.streak
    ? `${state.streak}일째 일기장을 채우는 중이에요.`
    : "오늘 한 장을 내면 기록이 시작돼요.";
  updateSaveHint();
}

function getUserProvider(user) {
  const provider = user?.app_metadata?.provider || user?.identities?.[0]?.provider || "";
  if (provider === "custom:naver" || provider === "naver") return { key: "naver", label: "Naver" };
  if (provider === "kakao") return { key: "kakao", label: "Kakao" };
  if (provider === "google") return { key: "google", label: "Google" };
  return { key: "unknown", label: "로그인됨" };
}

function setProviderBadge(user) {
  if (!authProviderBadge) return;
  if (!user) {
    authProviderBadge.classList.add("hidden");
    authProviderBadge.textContent = "";
    return;
  }

  const provider = getUserProvider(user);
  authProviderBadge.classList.remove("hidden");
  authProviderBadge.textContent = `${user.user_metadata?.full_name || "학생"}님`;
}

function selectedBook() {
  return diaryBooks.find((book) => book.id === currentBookId) || null;
}

function renderDiaryBooks() {
  if (!bookCard || !bookSelect) return;
  bookCard.classList.toggle("hidden", !currentUser);

  const previousBookId = currentBookId;
  bookSelect.innerHTML = '<option value="">나만 보기</option>';
  diaryBooks.forEach((book) => {
    const option = document.createElement("option");
    option.value = book.id;
    option.textContent = book.name;
    bookSelect.append(option);
  });

  currentBookId = diaryBooks.some((book) => book.id === previousBookId) ? previousBookId : "";
  bookSelect.value = currentBookId;
  updateBookHint();
}

function updateBookHint() {
  if (!bookHint || !copyInviteCode) return;
  const book = selectedBook();
  if (!book) {
    bookHint.textContent = "나만 보는 일기장에 저장돼요.";
    copyInviteCode.classList.add("hidden");
    if (currentBookLabel) currentBookLabel.textContent = "나만 보기";
    updateSaveHint();
    return;
  }

  bookHint.textContent = `초대 코드 ${book.invite_code}로 같이 볼 사람을 불러올 수 있어요.`;
  copyInviteCode.classList.remove("hidden");
  if (currentBookLabel) currentBookLabel.textContent = book.name;
  updateSaveHint();
}

async function loadDiaryBooks() {
  if (!supabase || !currentUser) {
    diaryBooks = [];
    currentBookId = "";
    renderDiaryBooks();
    return;
  }

  const { data, error } = await supabase
    .from("diary_books")
    .select("id, name, invite_code, owner_id, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    setLog("공유 일기장을 가져오지 못했어요.", "error");
    return;
  }

  diaryBooks = data || [];
  renderDiaryBooks();
}

function createInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function completeKakaoLoginFromHash() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("kakao_login") !== "1") return false;

  const tokenResponse = await fetch("/api/kakao-session", { cache: "no-store" });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenPayload.ok || !tokenPayload.idToken) {
    setLog("로그인 연결에 실패했어요.", "error");
    window.history.replaceState({}, document.title, window.location.pathname);
    return true;
  }

  window.history.replaceState({}, document.title, window.location.pathname);
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "kakao",
    token: tokenPayload.idToken,
  });

  if (error) {
    setLog("로그인 처리 중 문제가 생겼어.", "error");
    return true;
  }

  currentUser = data.user || null;
  setAuthUi();
  return true;
}

function setAuthUi() {
  if (!supabase) {
    authButtons.forEach((button) => { button.disabled = true; });
    saveDiary.disabled = !currentImageUrl.startsWith("data:");
    updateRitualUi();
    return;
  }

  authButtons.forEach((button) => { button.disabled = Boolean(currentUser); });
  signOut.classList.toggle("hidden", !currentUser);
  saveDiary.disabled = !currentImageUrl.startsWith("data:");
  setProviderBadge(currentUser);
  updateRitualUi();
  updateSaveHint();
}

function setCurrentImage(url, format = "png") {
  currentImageUrl = url;
  currentImageFormat = format;
  currentImageFilename = createImageFilename(currentImageFormat);
  resultImage.src = currentImageUrl;
  downloadLink.href = currentImageUrl;
  downloadLink.download = currentImageFilename;
  downloadLink.classList.remove("disabled");
  setStep(currentImageUrl.startsWith("data:") ? "save" : "write");
  setAuthUi();
}

function shareText() {
  const state = getTodayRitualState();
  return SHARE_LINES[state.generations % SHARE_LINES.length];
}

async function shareImageThroughInstalledApps() {
  const pageUrl = getSharePageUrl();
  const baseShareData = {
    title: "그림일기 타임머신",
    text: shareText(),
    url: pageUrl,
  };

  if (!navigator.share) {
    await navigator.clipboard.writeText(pageUrl);
    setLog("링크를 복사했어요.");
    return;
  }

  if (currentImageUrl.startsWith("data:")) {
    const file = await createImageFileFromDataUrl(currentImageUrl, currentImageFilename);
    const fileShareData = { title: baseShareData.title, text: baseShareData.text, files: [file] };
    if (!navigator.canShare || navigator.canShare(fileShareData)) {
      await navigator.share(fileShareData);
      return;
    }
  }

  await navigator.share(baseShareData);
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);base64/)?.[1] || "image/png";
  const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderDiaryEntries(entries = []) {
  if (!currentUser) {
    diaryList.innerHTML = '<div class="empty-state">아직 모은 일기가 없어요.</div>';
    return;
  }

  if (!entries.length) {
    diaryList.innerHTML = '<div class="empty-state">아직 모은 일기가 없어.</div>';
    return;
  }

  diaryList.innerHTML = entries.map((entry) => `
    <article class="diary-entry">
      <button type="button" class="diary-entry__image" data-entry-id="${entry.id}">
        <img src="${escapeHtml(entry.image_url)}" alt="${escapeHtml(entry.title)}" loading="lazy" />
      </button>
      <div class="diary-entry__body">
        <div class="diary-entry__meta">${escapeHtml(entry.diary_date || "날짜 없음")}</div>
        <h3>${escapeHtml(entry.title)}</h3>
      </div>
    </article>
  `).join("");

  diaryList.querySelectorAll("[data-entry-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = entries.find((item) => item.id === button.dataset.entryId);
      if (!entry) return;
      setCurrentImage(entry.image_url, entry.image_format || "png");
      setLog(`${entry.diary_date || "이전"} 일기를 펼쳤어요.`);
    });
  });
}

async function loadDiaryEntries() {
  if (!supabase || !currentUser) {
    renderDiaryEntries([]);
    return;
  }

  let query = supabase
    .from("diary_entries")
    .select("id, diary_date, weather, title, place, image_url, image_path, image_format, created_at")
    .order("created_at", { ascending: false })
    .limit(60);

  query = currentBookId ? query.eq("book_id", currentBookId) : query.is("book_id", null);
  const { data, error } = await query;

  if (error) {
    diaryList.innerHTML = `<div class="empty-state">일기장을 가져오지 못했어요.</div>`;
    return;
  }

  const entries = await withSignedImageUrls(data || []);
  renderDiaryEntries(entries);
}

async function withSignedImageUrls(entries) {
  return Promise.all(entries.map(async (entry) => {
    const imagePath = entry.image_path || getStoredImagePath(entry.image_url);
    if (!imagePath) return entry;

    const { data, error } = await supabase.storage.from("diary-images").createSignedUrl(imagePath, 60 * 60);
    if (error) return entry;
    return { ...entry, image_url: data.signedUrl };
  }));
}

function getStoredImagePath(value) {
  const imageUrl = String(value || "");
  if (!imageUrl) return "";
  if (!imageUrl.startsWith("http")) return imageUrl;

  try {
    const url = new URL(imageUrl);
    const marker = "/storage/v1/object/public/diary-images/";
    const index = url.pathname.indexOf(marker);
    return index === -1 ? "" : decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch {
    return "";
  }
}

async function initAuth() {
  const config = await getSupabaseConfig();
  if (!config.configured) {
    setAuthUi();
    renderDiaryEntries([]);
    return;
  }

  supabase = await getSupabaseClient();
  const completedKakaoLogin = await completeKakaoLoginFromHash();
  setAuthUi();
  const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  currentUser = data.user || null;
  setAuthUi();
  const params = new URLSearchParams(window.location.search);
  const authError = params.get("error_description") || params.get("error");
  if (!completedKakaoLogin && authError) {
    setLog("로그인 중에 문제가 생겼어.", "error");
  }
  await loadDiaryBooks();
  await loadDiaryEntries();
  await restorePendingSaveIfNeeded();

  if (authError) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    setAuthUi();
    await loadDiaryBooks();
    await loadDiaryEntries();
    await restorePendingSaveIfNeeded();
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("사진을 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    alert("사진이 너무 커요. 좀 더 작은 사진으로 골라주세요.");
    photoInput.value = "";
    return;
  }
  referenceImageDataUrl = await readFileAsDataUrl(file);
  photoPreview.src = referenceImageDataUrl;
  photoPreviewWrap.classList.remove("hidden");
  setLog("사진을 붙였어요.");
});

textModeInputs.forEach((input) => {
  input.addEventListener("change", updateTextModeUi);
});

async function getAccessToken() {
  if (!supabase) return "";
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

async function storeCurrentImageForLoginSave() {
  if (!currentImageUrl.startsWith("data:")) return;
  await writePendingSave({
    imageUrl: currentImageUrl,
    imageFormat: currentImageFormat,
    input: lastGeneratedInput || formData(),
    stamp: currentStamp,
    bookId: currentBookId,
    createdAt: Date.now(),
  });
}

function openSaveLoginModal() {
  if (!saveLoginModal) return;
  saveLoginModal.classList.remove("hidden");
}

function closeSaveLoginModalView() {
  if (!saveLoginModal) return;
  saveLoginModal.classList.add("hidden");
}

async function startAuth(provider, { saveAfterLogin = false } = {}) {
  if (!supabase) {
    setLog("로그인 설정을 불러오지 못했어요.", "error");
    return;
  }

  if (saveAfterLogin) {
    await storeCurrentImageForLoginSave();
  }

  if (provider === "kakao") {
    window.location.href = "/api/kakao-login";
    return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) setLog("로그인을 시작하지 못했어요.", "error");
}

clearPhoto.addEventListener("click", async () => {
  photoInput.value = "";
  referenceImageDataUrl = "";
  photoPreview.src = "";
  photoPreviewWrap.classList.add("hidden");
  setLog("사진을 뺐어요.");
});

copyShareText.addEventListener("click", async () => {
  await navigator.clipboard.writeText(shareText());
  setLog("문구를 복사했어요.");
});

stampButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentStamp = button.dataset.stamp || "";
    stampButtons.forEach((item) => item.classList.toggle("selected", item === button));
    setLog(`${currentStamp} 도장을 쾅 찍었어!`);
  });
});

socialShareButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const target = button.dataset.shareTarget;
    try {
      if (target === "instagram") {
        await shareImageThroughInstalledApps();
        return;
      }

      const url = buildSocialShareUrl(target, {
        text: shareText(),
        url: getSharePageUrl(),
      });
      window.open(url, "_blank", "noopener,noreferrer,width=720,height=640");
    } catch {
      setLog("이미지를 저장한 뒤 앱에서 공유해주세요.", "error");
    }
  });
});

authButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const provider = button.dataset.authProvider;
    await startAuth(provider, {
      saveAfterLogin: button.dataset.saveAfterLogin === "true",
    });
  });
});

closeSaveLoginModal?.addEventListener("click", closeSaveLoginModalView);

saveLoginModal?.addEventListener("click", (event) => {
  if (event.target === saveLoginModal) closeSaveLoginModalView();
});

signOut.addEventListener("click", async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
  currentUser = null;
  setAuthUi();
  renderDiaryEntries([]);
});

refreshDiary.addEventListener("click", loadDiaryEntries);

eraserChance.addEventListener("click", () => {
  form.requestSubmit();
});

async function saveGeneratedDiary({
  imageUrl = currentImageUrl,
  imageFormat = currentImageFormat,
  input = lastGeneratedInput || formData(),
  stamp = currentStamp,
  bookId = currentBookId,
} = {}) {
  if (!supabase || !currentUser) return false;
  if (!imageUrl.startsWith("data:")) return false;

  const data = input;
  const ext = imageFormat === "jpeg" ? "jpg" : imageFormat;
  const path = `${currentUser.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const blob = dataUrlToBlob(imageUrl);

  saveDiary.disabled = true;
  setLog("일기장에 붙이는 중이에요...");

  const upload = await supabase.storage.from("diary-images").upload(path, blob, {
    contentType: blob.type,
    upsert: false,
  });

  if (upload.error) {
    saveDiary.disabled = false;
    updateSaveHint();
    setLog("일기를 붙이지 못했어요.", "error");
    return false;
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage.from("diary-images").createSignedUrl(path, 60 * 60);
  if (signedUrlError) {
    saveDiary.disabled = false;
    updateSaveHint();
    setLog("일기 링크를 만들지 못했어요.", "error");
    return false;
  }

  const insert = await supabase.from("diary_entries").insert({
    user_id: currentUser.id,
    book_id: bookId || null,
    diary_date: data.date || getSeoulDateKey(),
    weather: data.weather || "맑음",
    title: data.title || "오늘의 일기",
    child: "초등학생",
    place: data.diary || "오늘 있었던 일",
    diary_text: data.diary || "",
    detail: stamp || data.moodType || "",
    image_url: path,
    image_path: path,
    image_format: imageFormat,
  });

  saveDiary.disabled = false;
  updateSaveHint();
  if (insert.error) {
    setLog("일기를 저장하지 못했어요.", "error");
    return false;
  }

  setLog("일기장에 붙였어요.");
  setCurrentImage(signedUrlData.signedUrl, imageFormat);
  setStep("write");
  await loadDiaryEntries();
  return true;
}

async function restorePendingSaveIfNeeded() {
  if (restoringPendingSave || !currentUser) return;
  restoringPendingSave = true;
  try {
    const pending = await readPendingSave();
    if (!pending?.imageUrl) return;
    lastGeneratedInput = pending.input || null;
    currentStamp = pending.stamp || "";
    currentBookId = pending.bookId || "";
    renderDiaryBooks();
    setCurrentImage(pending.imageUrl, pending.imageFormat || "png");
    const saved = await saveGeneratedDiary({
      imageUrl: pending.imageUrl,
      imageFormat: pending.imageFormat || "png",
      input: pending.input || formData(),
      stamp: pending.stamp || "",
      bookId: pending.bookId || "",
    });
    if (saved) await clearPendingSave();
  } finally {
    restoringPendingSave = false;
  }
}

saveDiary.addEventListener("click", async () => {
  if (!currentImageUrl.startsWith("data:")) {
    setLog("새로 만든 그림일기만 붙일 수 있어요.", "error");
    return;
  }

  if (!supabase || !currentUser) {
    await storeCurrentImageForLoginSave();
    openSaveLoginModal();
    return;
  }

  await saveGeneratedDiary();
});

bookSelect?.addEventListener("change", async () => {
  currentBookId = bookSelect.value;
  updateBookHint();
  await loadDiaryEntries();
});

copyInviteCode?.addEventListener("click", async () => {
  const book = selectedBook();
  if (!book) return;
  await navigator.clipboard.writeText(book.invite_code);
  setLog("초대 코드를 복사했어요.");
});

createBookForm?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    createBookButton?.click();
  }
});

createBookButton?.addEventListener("click", async () => {
  if (!supabase || !currentUser) {
    setLog("먼저 로그인해주세요.", "error");
    return;
  }

  const nameInput = createBookForm?.querySelector("input[name='bookName']");
  const name = String(nameInput?.value || "").trim();
  if (!name) {
    setLog("공유 일기장 이름을 적어주세요.", "error");
    nameInput?.focus();
    return;
  }

  setFormControlsDisabled(createBookForm, true);
  setLog("공유 일기장을 만드는 중이에요...");
  const bookId = crypto.randomUUID();
  const bookInsert = await supabase
    .from("diary_books")
    .insert({
      id: bookId,
      owner_id: currentUser.id,
      name,
      invite_code: createInviteCode(),
    });

  if (bookInsert.error) {
    setFormControlsDisabled(createBookForm, false);
    setLog("공유 일기장을 만들지 못했어요.", "error");
    return;
  }

  const memberInsert = await supabase.from("diary_book_members").insert({
    book_id: bookId,
    user_id: currentUser.id,
    role: "owner",
  });

  if (memberInsert.error) {
    setFormControlsDisabled(createBookForm, false);
    setLog("일기장 멤버 등록에 실패했어요.", "error");
    return;
  }

  if (nameInput) nameInput.value = "";
  setFormControlsDisabled(createBookForm, false);
  currentBookId = bookId;
  await loadDiaryBooks();
  await loadDiaryEntries();
  setLog("공유 일기장을 만들었어요.");
});

joinBookForm?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    joinBookButton?.click();
  }
});

joinBookButton?.addEventListener("click", async () => {
  if (!supabase || !currentUser) {
    setLog("먼저 로그인해주세요.", "error");
    return;
  }

  const inviteCodeInput = joinBookForm?.querySelector("input[name='inviteCode']");
  const inviteCode = String(inviteCodeInput?.value || "")
    .trim()
    .toUpperCase();
  if (!inviteCode) {
    setLog("초대 코드를 입력해주세요.", "error");
    inviteCodeInput?.focus();
    return;
  }

  setFormControlsDisabled(joinBookForm, true);
  setLog("초대 코드를 확인하는 중이에요...");
  const { data, error } = await supabase.rpc("join_diary_book_by_code", {
    invite_code_input: inviteCode,
  });

  if (error || !data) {
    setFormControlsDisabled(joinBookForm, false);
    setLog("초대 코드로 일기장을 찾지 못했어요.", "error");
    return;
  }

  if (inviteCodeInput) inviteCodeInput.value = "";
  setFormControlsDisabled(joinBookForm, false);
  currentBookId = data;
  await loadDiaryBooks();
  await loadDiaryEntries();
  setLog("공유 일기장에 들어왔어요.");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (remainingGenerations() <= 0) {
    updateRitualUi();
    setLog(currentUser ? "오늘은 여기까지예요." : "체험은 한 번만 가능해요.");
    return;
  }
  if (!validateRequiredInputs()) return;

  loading.classList.remove("hidden");
  setStep("generate");
  generateBtn.disabled = true;
  eraserChance.disabled = true;
  loadingText.textContent = LOADING_LINES[getTodayRitualState().generations % LOADING_LINES.length];

  try {
    const accessToken = await getAccessToken();
    const requestData = formData();
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        ...requestData,
        trialGeneration: !accessToken,
      }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "생성 실패");

    setCurrentImage(json.image, requestData.outputFormat || "png");
    lastGeneratedInput = requestData;
    recordSuccessfulGeneration();
    updateRitualUi();
    setLog("그림일기를 만들었어요.");
  } catch (error) {
    setStep("write");
    setLog("일기가 번졌나 봐요. 다시 한 번 써볼까요?", "error");
  } finally {
    loading.classList.add("hidden");
    updateRitualUi();
  }
});

setCurrentImage(currentImageUrl, currentImageFormat);
initAuth();
updateRitualUi();
updateTextModeUi();
