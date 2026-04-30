import {
  buildSocialShareUrl,
  createImageFileFromDataUrl,
  createImageFilename,
  getSharePageUrl,
} from "./share-utils.js";
import { getSupabaseClient, getSupabaseConfig } from "./supabase-client.js?v=20260430-disabled-form";
import {
  getSeoulDateKey,
  getStreakReward,
  getTodayRitualState,
  LOADING_LINES,
  MAX_DAILY_GENERATIONS,
  remainingGenerations as getRemainingGenerations,
  saveSuccessfulGeneration as recordSuccessfulGeneration,
  SHARE_LINES,
  writeRitualState,
} from "./ritual-state.js";

const form = document.querySelector("#diaryForm");
const statusEl = document.querySelector("#status");
const photoInput = document.querySelector("#photo");
const photoPreviewWrap = document.querySelector("#photoPreviewWrap");
const photoPreview = document.querySelector("#photoPreview");
const clearPhoto = document.querySelector("#clearPhoto");
const creationFields = document.querySelector("#creationFields");
const lockedPreview = document.querySelector("#lockedPreview");
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
const streakTitle = document.querySelector("#streakTitle");
const streakText = document.querySelector("#streakText");
const authTitle = document.querySelector("#authTitle");
const authSubtitle = document.querySelector("#authSubtitle");
const authCard = document.querySelector("#authCard");
const authActions = document.querySelector("#authActions");
const authProviderBadge = document.querySelector("#authProviderBadge");
const authButtons = document.querySelectorAll("[data-auth-provider]");
const signOut = document.querySelector("#signOut");
const saveDiary = document.querySelector("#saveDiary");
const refreshDiary = document.querySelector("#refreshDiary");
const diaryList = document.querySelector("#diaryList");
const diaryBookHint = document.querySelector("#diaryBookHint");

let referenceImageDataUrl = "";
let currentImageUrl = resultImage.getAttribute("src") || "/sample-output.png";
let currentImageFormat = "png";
let currentImageFilename = createImageFilename(currentImageFormat);
let supabase = null;
let currentUser = null;
let lastGeneratedInput = null;
let authNotice = "";
let currentStamp = "";
let authRequiredForGenerate = false;
let authConfigured = false;


function formData() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.referenceImageDataUrl = referenceImageDataUrl;
  data.size = "1024x1536";
  data.quality = "medium";
  data.outputFormat = "png";
  return data;
}

function validateRequiredInputs() {
  const diary = form.elements.diary;
  if (String(diary.value || "").trim()) return true;
  diary.reportValidity();
  setLog("오늘 한 줄만 써줘. 진짜 짧아도 괜찮아.", "error");
  return false;
}

function setLog(message, tone = "normal") {
  log.textContent = message || "";
  log.dataset.tone = tone;
}

function setText(element, text) {
  if (element) element.textContent = text;
}

function remainingGenerations() {
  return getRemainingGenerations(getTodayRitualState());
}

function needsLoginForGeneration() {
  return authRequiredForGenerate && !currentUser;
}

function cannotStartLogin() {
  return authRequiredForGenerate && !authConfigured;
}

function updateRitualUi() {
  const state = getTodayRitualState();
  writeRitualState(state);
  const remaining = getRemainingGenerations(state);
  const locked = remaining <= 0;
  const hasUsedFirst = state.generations > 0;
  const needsLogin = needsLoginForGeneration();
  const authUnavailable = cannotStartLogin();

  if (authUnavailable) {
    quotaTitle.textContent = "샘플로 결과를 먼저 확인해봐.";
    quotaText.textContent = "지금은 직접 만들기 설정이 아직 준비되지 않았어.";
  } else if (needsLogin) {
    quotaTitle.textContent = "샘플로 결과를 먼저 확인해봐.";
    quotaText.textContent = "직접 만들기는 로그인 후 열려.";
  } else if (state.generations === 0) {
    quotaTitle.textContent = "오늘 일기는 아직 안 냈어.";
    quotaText.textContent = "오늘의 그림일기 1장 남음";
  } else if (state.generations === 1) {
    quotaTitle.textContent = "오늘 일기는 냈어.";
    quotaText.textContent = "지우개 찬스 1번 남았어.";
  } else {
    quotaTitle.textContent = "선생님이 오늘은 여기까지래.";
    quotaText.textContent = "지우개 찬스까지 썼어. 내일 또 써보자.";
  }

  quotaCard.dataset.state = authUnavailable ? "locked" : needsLogin ? "login" : locked ? "locked" : hasUsedFirst ? "eraser" : "ready";
  creationFields.classList.toggle("form-locked", authUnavailable || needsLogin);
  creationFields.setAttribute("aria-disabled", String(authUnavailable || needsLogin));
  lockedPreview.classList.toggle("hidden", !authUnavailable && !needsLogin);
  generateBtn.disabled = locked || authUnavailable || needsLogin;
  generateBtn.textContent = authUnavailable ? "직접 만들기 준비 중" : needsLogin ? "로그인 후 직접 만들기" : hasUsedFirst ? "지우개 찬스로 다시 만들기" : "오늘의 그림일기 만들기";
  eraserChance.classList.toggle("hidden", !hasUsedFirst || locked);
  eraserChance.disabled = locked || needsLogin || authUnavailable;
  form.elements.diary.disabled = locked || authUnavailable || needsLogin;
  photoInput.disabled = locked || authUnavailable || needsLogin;
  form.querySelectorAll("input[name='moodType']").forEach((input) => { input.disabled = locked || authUnavailable || needsLogin; });

  streakTitle.textContent = getStreakReward(state.streak);
  streakText.textContent = state.streak
    ? `${state.streak}일째 방학숙제장을 채우는 중이야.`
    : "오늘 한 장을 내면 연속 기록이 시작돼.";
}

function getUserProvider(user) {
  const provider = user?.app_metadata?.provider || user?.identities?.[0]?.provider || "";
  if (provider === "custom:naver" || provider === "naver") return { key: "naver", label: "Naver 로그인 중" };
  if (provider === "kakao") return { key: "kakao", label: "KakaoTalk 로그인 중" };
  if (provider === "google") return { key: "google", label: "Google 로그인 중" };
  return { key: "unknown", label: "로그인 완료" };
}

function setProviderBadge(user) {
  if (!authProviderBadge) return;
  if (!user) {
    authProviderBadge.className = "auth-provider-badge hidden";
    authProviderBadge.textContent = "";
    return;
  }

  const provider = getUserProvider(user);
  authProviderBadge.className = `auth-provider-badge auth-provider-badge--${provider.key}`;
  authProviderBadge.textContent = provider.label;
}

async function completeKakaoLoginFromHash() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("kakao_login") !== "1") return false;

  const tokenResponse = await fetch("/api/kakao-session", { cache: "no-store" });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenPayload.ok || !tokenPayload.idToken) {
    authNotice = tokenPayload.error || "KakaoTalk 로그인 토큰을 받지 못했어.";
    setAuthUi(authNotice);
    window.history.replaceState({}, document.title, window.location.pathname);
    return true;
  }

  window.history.replaceState({}, document.title, window.location.pathname);
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "kakao",
    token: tokenPayload.idToken,
  });

  if (error) {
    authNotice = `KakaoTalk 로그인 처리 중 문제가 생겼어: ${error.message}`;
    setAuthUi(authNotice);
    return true;
  }

  currentUser = data.user || null;
  authNotice = "KakaoTalk 계정으로 연결됐어. 이제 일기장을 저장할 수 있어.";
  setAuthUi(authNotice);
  return true;
}

function setAuthUi(message = "") {
  const displayMessage = message || authNotice;

  if (!supabase) {
    setText(authTitle, "Supabase 설정이 필요해");
    setText(authSubtitle, "로그인 설정이 켜져야 그림일기를 만들 수 있어. 지금은 사이트 미리보기만 가능해.");
    authCard.dataset.state = "unavailable";
    setProviderBadge(null);
    authButtons.forEach((button) => { button.disabled = true; });
    saveDiary.disabled = true;
    setText(diaryBookHint, "로그인하면 날짜별 숙제를 모아볼 수 있어.");
    updateRitualUi();
    return;
  }

  authButtons.forEach((button) => { button.disabled = Boolean(currentUser); });
  authActions.classList.toggle("hidden", Boolean(currentUser));
  authCard.dataset.state = currentUser ? "ready" : "required";
  signOut.classList.toggle("hidden", !currentUser);
  saveDiary.disabled = !currentUser || !currentImageUrl.startsWith("data:");
  setProviderBadge(currentUser);

  if (currentUser) {
    const provider = getUserProvider(currentUser);
    setText(authTitle, currentUser.user_metadata?.full_name || currentUser.email || "로그인됨");
    setText(authSubtitle, displayMessage || `${provider.label.replace(" 중", "")} 계정으로 연결됐어. 이제 오늘의 그림일기를 만들 수 있어.`);
    setText(diaryBookHint, "날짜별로 제출한 그림일기를 다시 볼 수 있어.");
  } else {
    setText(authTitle, "직접 만들기는 로그인 후 가능해");
    setText(authSubtitle, displayMessage || "샘플을 보고 마음에 들면 아래 계정 중 하나로 로그인해. 네 OpenAI 키는 필요 없어.");
    setText(diaryBookHint, "로그인하면 날짜별로 전에 냈던 숙제를 다시 볼 수 있어.");
  }
  updateRitualUi();
}

function setCurrentImage(url, format = "png") {
  currentImageUrl = url;
  currentImageFormat = format;
  currentImageFilename = createImageFilename(currentImageFormat);
  resultImage.src = currentImageUrl;
  downloadLink.href = currentImageUrl;
  downloadLink.download = currentImageFilename;
  downloadLink.classList.remove("disabled");
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
    setLog("이 브라우저는 앱 공유를 지원하지 않아서 링크를 복사했어.");
    return;
  }

  if (currentImageUrl.startsWith("data:")) {
    const file = await createImageFileFromDataUrl(currentImageUrl, currentImageFilename);
    const fileShareData = { title: baseShareData.title, text: baseShareData.text, files: [file] };
    if (!navigator.canShare || navigator.canShare(fileShareData)) {
      await navigator.share(fileShareData);
      setLog("이미지를 공유했어.");
      return;
    }
  }

  await navigator.share(baseShareData);
  setLog("공유 창을 열었어.");
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const json = await res.json();
    if (json.hasApiKey) {
      statusEl.textContent = json.authRequiredForGenerate ? "로그인 후 숙제 제출 가능" : "방학숙제장 준비됨";
    } else {
      statusEl.textContent = "API 키 없음 · 오늘 숙제 제출은 잠시 쉬는 중";
    }
  } catch {
    statusEl.textContent = "일기장 확인 실패";
  }
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
    diaryList.innerHTML = '<div class="empty-state">로그인하면 내 방학숙제장을 볼 수 있어.</div>';
    return;
  }

  if (!entries.length) {
    diaryList.innerHTML = '<div class="empty-state">아직 제출한 그림일기가 없어.</div>';
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
      setLog(`${entry.diary_date || "이전"} 그림일기를 열었어.`);
    });
  });
}

async function loadDiaryEntries() {
  if (!supabase || !currentUser) {
    renderDiaryEntries([]);
    return;
  }

  const { data, error } = await supabase
    .from("diary_entries")
    .select("id, diary_date, weather, title, place, image_url, image_path, image_format, created_at")
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    diaryList.innerHTML = `<div class="empty-state">일기장을 불러오지 못했어: ${escapeHtml(error.message)}</div>`;
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
  authRequiredForGenerate = config.authRequiredForGenerate;
  authConfigured = config.configured;
  if (!config.configured) {
    setAuthUi();
    renderDiaryEntries([]);
    return;
  }

  supabase = await getSupabaseClient();
  const completedKakaoLogin = await completeKakaoLoginFromHash();
  const { data } = await supabase.auth.getUser();
  currentUser = data.user || null;
  const params = new URLSearchParams(window.location.search);
  const authError = params.get("error_description") || params.get("error");
  if (!completedKakaoLogin) {
    authNotice = authError ? `로그인 처리 중 문제가 생겼어: ${authError}` : "";
    setAuthUi(authError ? `로그인 처리 중 문제가 생겼어: ${authError}` : "");
  }
  await loadDiaryEntries();

  if (authError) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    if (currentUser) authNotice = "";
    setAuthUi();
    await loadDiaryEntries();
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("사진을 읽지 못했어."));
    reader.readAsDataURL(file);
  });
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    alert("사진이 너무 커. 10MB 이하로 줄여서 넣어줘.");
    photoInput.value = "";
    return;
  }
  referenceImageDataUrl = await readFileAsDataUrl(file);
  photoPreview.src = referenceImageDataUrl;
  photoPreviewWrap.classList.remove("hidden");
  setLog("사진 붙였어. 없어도 되지만, 있으면 오늘 장면을 조금 더 기억해볼게.");
});

async function getAccessToken() {
  if (!supabase) return "";
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

clearPhoto.addEventListener("click", async () => {
  photoInput.value = "";
  referenceImageDataUrl = "";
  photoPreview.src = "";
  photoPreviewWrap.classList.add("hidden");
  setLog("사진은 뺐어. 한 줄만으로도 숙제 낼 수 있어.");
});

form.addEventListener("input", () => {
  if (remainingGenerations() <= 0) {
    setLog("오늘 일기는 다 냈어. 내일 또 숙제하러 와.");
  }
});

copyShareText.addEventListener("click", async () => {
  await navigator.clipboard.writeText(shareText());
  setLog("친구한테 보낼 말 복사했어.");
});

stampButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentStamp = button.dataset.stamp || "";
    stampButtons.forEach((item) => item.classList.toggle("selected", item === button));
    setLog(`${currentStamp} 도장 찍었어.`);
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
    } catch (error) {
      if (error.name === "AbortError") {
        setLog("공유를 취소했어.");
        return;
      }
      setLog("공유가 막혔어. 이미지 저장 후 앱에서 직접 올려줘.", "error");
    }
  });
});

authButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (!supabase) return;
    const provider = button.dataset.authProvider;
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
    if (error) setLog(`로그인 시작 실패: ${error.message}`, "error");
  });
});

signOut.addEventListener("click", async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
  currentUser = null;
  authNotice = "로그아웃했어.";
  setAuthUi("로그아웃했어.");
  renderDiaryEntries([]);
});

refreshDiary.addEventListener("click", loadDiaryEntries);

eraserChance.addEventListener("click", () => {
  form.requestSubmit();
});

saveDiary.addEventListener("click", async () => {
  if (!supabase || !currentUser) {
    setLog("로그인해야 일기장에 저장할 수 있어.", "error");
    return;
  }
  if (!currentImageUrl.startsWith("data:")) {
    setLog("새로 생성한 그림일기만 저장할 수 있어.", "error");
    return;
  }

  const data = lastGeneratedInput || formData();
  const ext = currentImageFormat === "jpeg" ? "jpg" : currentImageFormat;
  const path = `${currentUser.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const blob = dataUrlToBlob(currentImageUrl);

  saveDiary.disabled = true;
  setLog("일기장에 저장하는 중이야.");

  const upload = await supabase.storage.from("diary-images").upload(path, blob, {
    contentType: blob.type,
    upsert: false,
  });

  if (upload.error) {
    saveDiary.disabled = false;
    setLog(`이미지 저장 실패: ${upload.error.message}`, "error");
    return;
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage.from("diary-images").createSignedUrl(path, 60 * 60);
  if (signedUrlError) {
    saveDiary.disabled = false;
    setLog(`이미지 링크 생성 실패: ${signedUrlError.message}`, "error");
    return;
  }

  const insert = await supabase.from("diary_entries").insert({
    user_id: currentUser.id,
    diary_date: data.date || getSeoulDateKey(),
    weather: data.weather || "오늘 날씨",
    title: data.title || "오늘의 그림일기",
    child: "초등학교 2학년 남자아이",
    place: data.place || data.diary || "오늘 있었던 일",
    diary_text: data.diary || "",
    detail: currentStamp || data.moodType || "",
    image_url: path,
    image_path: path,
    image_format: currentImageFormat,
  });

  saveDiary.disabled = false;
  if (insert.error) {
    setLog(`일기 저장 실패: ${insert.error.message}`, "error");
    return;
  }

  setLog("방학숙제장에 붙였어.");
  setCurrentImage(signedUrlData.signedUrl, currentImageFormat);
  await loadDiaryEntries();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (remainingGenerations() <= 0) {
    updateRitualUi();
    setLog("오늘 일기는 다 냈어. 방학숙제는 하루에 한 장씩.");
    return;
  }
  if (needsLoginForGeneration()) {
    setLog("샘플을 먼저 보고, 직접 만들고 싶으면 로그인해줘.", "error");
    updateRitualUi();
    return;
  }
  if (!validateRequiredInputs()) return;

  loading.classList.remove("hidden");
  generateBtn.disabled = true;
  eraserChance.disabled = true;
  loadingText.textContent = LOADING_LINES[getTodayRitualState().generations % LOADING_LINES.length];
  setLog(getTodayRitualState().generations ? "선생님 몰래 다시 그리는 중이야." : "오늘 하루를 숙제장에 붙이는 중이야.");

  try {
    const accessToken = await getAccessToken();
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(formData()),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "생성 실패");

    setCurrentImage(json.image, formData().outputFormat || "png");
    lastGeneratedInput = formData();
    recordSuccessfulGeneration();
    updateRitualUi();
    setLog(getTodayRitualState().generations >= MAX_DAILY_GENERATIONS
      ? "오늘의 숙제 끝. 지우개 찬스까지 썼어."
      : "오늘의 그림일기 냈어. 마음에 안 들면 지우개 찬스가 한 번 남았어.");
  } catch (error) {
    setLog(error.message || "잉크가 번졌어. 실패한 숙제는 횟수로 안 칠게.", "error");
  } finally {
    loading.classList.add("hidden");
    updateRitualUi();
  }
});

setCurrentImage(currentImageUrl, currentImageFormat);
checkHealth();
initAuth();
updateRitualUi();
