import {
  buildSocialShareUrl,
  createImageFileFromDataUrl,
  createImageFilename,
  getSharePageUrl,
} from "./share-utils.js";
import { getSupabaseClient, getSupabaseConfig } from "./supabase-client.js";

const form = document.querySelector("#diaryForm");
const statusEl = document.querySelector("#status");
const photoInput = document.querySelector("#photo");
const photoPreviewWrap = document.querySelector("#photoPreviewWrap");
const photoPreview = document.querySelector("#photoPreview");
const clearPhoto = document.querySelector("#clearPhoto");
const promptOnly = document.querySelector("#promptOnly");
const promptPreview = document.querySelector("#promptPreview");
const generateBtn = document.querySelector("#generateBtn");
const resultImage = document.querySelector("#resultImage");
const loading = document.querySelector("#loading");
const downloadLink = document.querySelector("#downloadLink");
const copyPrompt = document.querySelector("#copyPrompt");
const log = document.querySelector("#log");
const socialShareButtons = document.querySelectorAll("[data-share-target]");
const authTitle = document.querySelector("#authTitle");
const authSubtitle = document.querySelector("#authSubtitle");
const authActions = document.querySelector("#authActions");
const authProviderBadge = document.querySelector("#authProviderBadge");
const authButtons = document.querySelectorAll("[data-auth-provider]");
const signOut = document.querySelector("#signOut");
const saveDiary = document.querySelector("#saveDiary");
const refreshDiary = document.querySelector("#refreshDiary");
const diaryList = document.querySelector("#diaryList");
const diaryBookHint = document.querySelector("#diaryBookHint");

let referenceImageDataUrl = "";
let lastPrompt = "";
let currentImageUrl = resultImage.getAttribute("src") || "/sample-output.png";
let currentImageFormat = "png";
let currentImageFilename = createImageFilename(currentImageFormat);
let supabase = null;
let currentUser = null;
let lastGeneratedInput = null;

const defaultPromptBuilder = (data) => `
Create one realistic photographed Korean elementary-school picture diary homework page.

Core concept:
- It must look like a real physical workbook page, casually photographed on a desk in natural indoor light.
- Era/context: ${data.era || "2010년대 초반 한국 초등학교 방학숙제"}.
- Student persona: ${data.child || "초등학교 2학년 남자아이"}.
- Page type: Korean “그림일기” worksheet with printed boxes for 날짜, 날씨, 제목, 그림, and 일기 lines.
- Date field: ${data.date || "2011년 8월 어느 날"}
- Weather field: ${data.weather || "맑음"}
- Title field: ${data.title || "즐거운 하루"}
- Place/event cue: ${data.place || "여름 방학에 놀러 간 곳"}
- Mood: ${data.mood || "옛날 추억, 살짝 구겨진 학습지"}
- Handwriting: ${data.handwriting || "초등학교 2학년 남자아이의 삐뚤빼뚤하지만 읽히는 연필 글씨"}

Diary content to appear in Korean handwriting, rewritten only slightly to sound like a 2nd grader:
${data.diary || "오늘 재미있는 일을 했다. 정말 신났다. 다음에 또 하고 싶다."}

Extra user details:
${data.detail || "없음"}

Visual requirements:
- The result is NOT a clean digital poster. It is a phone photo of paper.
- Use slightly wrinkled white workbook paper, faint shadows, page edge, printed gray table lines, and a small page number near the bottom.
- The top heading should say “그림일기”. Include a simple instruction line like a Korean workbook.
- Draw the main illustration as a child’s crayon drawing: naive proportions, uneven coloring, simple sun/trees/people/objects, imperfect lines, childlike perspective.
- The diary lines should be handwritten in Korean pencil, large and uneven, legible but juvenile.
- Make the written Korean plausible, short, and emotionally simple.
- Avoid looking too polished, too modern, or like a generated infographic.
- Keep the page portrait-oriented, similar to a Korean school workbook page photographed at a slight angle.

${referenceImageDataUrl ? "Reference image instruction: Use the uploaded photo only as memory/source material for the event, characters, place, composition, clothing colors, and props. Do not output the original photo. Transform it into a child-made picture diary page." : "No reference photo was provided. Infer a simple childlike scene from the diary text."}
`.trim();

function formData() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.referenceImageDataUrl = referenceImageDataUrl;
  return data;
}

function validateRequiredInputs() {
  const requiredNames = ["title", "place", "diary", "detail"];
  const missing = requiredNames
    .map((name) => form.elements[name])
    .find((field) => !String(field.value || "").trim());

  if (!missing) return true;
  missing.reportValidity();
  setLog("제목, 장소/상황, 일기 몇 줄, 디테일은 꼭 넣어줘.", "error");
  return false;
}

function hasRequiredPromptData(data) {
  return ["title", "place", "diary", "detail"].every((key) => String(data[key] || "").trim());
}

function setLog(message, tone = "normal") {
  log.textContent = message || "";
  log.dataset.tone = tone;
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

function getOAuthOptions(provider) {
  const options = {
    redirectTo: window.location.origin,
  };

  if (provider === "kakao") {
    options.scopes = "profile_nickname profile_image";
  }

  return options;
}

function setAuthUi(message = "") {
  if (!supabase) {
    authTitle.textContent = "Supabase 설정이 필요해";
    authSubtitle.textContent = "SUPABASE_URL, SUPABASE_ANON_KEY를 넣으면 로그인과 일기장이 켜져.";
    setProviderBadge(null);
    authButtons.forEach((button) => { button.disabled = true; });
    saveDiary.disabled = true;
    diaryBookHint.textContent = "Supabase 프로젝트를 연결하면 날짜별 그림일기를 저장하고 다시 볼 수 있어.";
    return;
  }

  authButtons.forEach((button) => { button.disabled = Boolean(currentUser); });
  authActions.classList.toggle("hidden", Boolean(currentUser));
  signOut.classList.toggle("hidden", !currentUser);
  saveDiary.disabled = !currentUser || !currentImageUrl.startsWith("data:");
  setProviderBadge(currentUser);

  if (currentUser) {
    const provider = getUserProvider(currentUser);
    authTitle.textContent = currentUser.user_metadata?.full_name || currentUser.email || "로그인됨";
    authSubtitle.textContent = message || `${provider.label.replace(" 중", "")} 계정으로 연결됐어. 생성한 그림일기를 내 일기장에 저장할 수 있어.`;
    diaryBookHint.textContent = "날짜별로 저장된 그림일기를 다시 볼 수 있어.";
  } else {
    authTitle.textContent = "로그인하면 일기장이 저장돼";
    authSubtitle.textContent = message || "Google, KakaoTalk, Naver 계정으로 이어서 볼 수 있어.";
    diaryBookHint.textContent = "로그인하면 날짜별로 전에 썼던 그림일기를 다시 볼 수 있어.";
  }
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
  const data = formData();
  const title = data.title || "그림일기";
  return `그림일기 타임머신으로 만든 ${title}`;
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

async function refreshPrompt() {
  const data = formData();
  if (!hasRequiredPromptData(data)) {
    lastPrompt = "";
    promptPreview.textContent = "제목, 장소/상황, 일기 몇 줄, 디테일을 모두 입력하면 프롬프트가 만들어져.";
    return;
  }

  try {
    const res = await fetch("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    lastPrompt = json.prompt || defaultPromptBuilder(data);
  } catch {
    lastPrompt = defaultPromptBuilder(data);
  }
  promptPreview.textContent = lastPrompt;
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const json = await res.json();
    if (json.hasApiKey) {
      statusEl.textContent = `API 연결 준비됨 · ${json.imageModel}`;
    } else {
      statusEl.textContent = "API 키 없음 · 샘플/프롬프트 미리보기만 가능";
    }
  } catch {
    statusEl.textContent = "서버 연결 확인 실패";
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
    diaryList.innerHTML = '<div class="empty-state">로그인하면 내 그림일기장을 볼 수 있어.</div>';
    return;
  }

  if (!entries.length) {
    diaryList.innerHTML = '<div class="empty-state">아직 저장된 그림일기가 없어.</div>';
    return;
  }

  diaryList.innerHTML = entries.map((entry) => `
    <article class="diary-entry">
      <button type="button" class="diary-entry__image" data-entry-id="${entry.id}">
        <img src="${escapeHtml(entry.image_url)}" alt="${escapeHtml(entry.title)}" loading="lazy" />
      </button>
      <div class="diary-entry__body">
        <div class="diary-entry__meta">${escapeHtml(entry.diary_date || "날짜 없음")} · ${escapeHtml(entry.weather || "날씨 없음")}</div>
        <h3>${escapeHtml(entry.title)}</h3>
        <p>${escapeHtml(entry.place)}</p>
        <button type="button" class="ghost mini" data-delete-entry="${entry.id}">삭제</button>
      </div>
    </article>
  `).join("");

  diaryList.querySelectorAll("[data-entry-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = entries.find((item) => item.id === button.dataset.entryId);
      if (!entry) return;
      setCurrentImage(entry.image_url, entry.image_format || "png");
      promptPreview.textContent = entry.prompt || "";
      lastPrompt = entry.prompt || "";
      setLog(`${entry.diary_date || "이전"} 그림일기를 열었어.`);
    });
  });

  diaryList.querySelectorAll("[data-delete-entry]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!supabase || !currentUser) return;
      const id = button.dataset.deleteEntry;
      const { error } = await supabase.from("diary_entries").delete().eq("id", id);
      if (error) {
        setLog(`삭제 실패: ${error.message}`, "error");
        return;
      }
      setLog("일기를 삭제했어.");
      await loadDiaryEntries();
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
    .select("id, diary_date, weather, title, place, image_url, image_format, prompt, created_at")
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    diaryList.innerHTML = `<div class="empty-state">일기장을 불러오지 못했어: ${escapeHtml(error.message)}</div>`;
    return;
  }

  renderDiaryEntries(data || []);
}

async function initAuth() {
  const config = await getSupabaseConfig();
  if (!config.configured) {
    setAuthUi();
    renderDiaryEntries([]);
    return;
  }

  supabase = await getSupabaseClient();
  const { data } = await supabase.auth.getUser();
  currentUser = data.user || null;
  const params = new URLSearchParams(window.location.search);
  const authError = params.get("error_description") || params.get("error");
  setAuthUi(authError ? `로그인 처리 중 문제가 생겼어: ${authError}` : "");
  await loadDiaryEntries();

  if (authError) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
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
  await refreshPrompt();
});

clearPhoto.addEventListener("click", async () => {
  photoInput.value = "";
  referenceImageDataUrl = "";
  photoPreview.src = "";
  photoPreviewWrap.classList.add("hidden");
  await refreshPrompt();
});

form.addEventListener("input", () => {
  window.clearTimeout(form._timer);
  form._timer = window.setTimeout(refreshPrompt, 180);
});

promptOnly.addEventListener("click", async () => {
  if (!validateRequiredInputs()) return;
  await refreshPrompt();
  setLog("프롬프트만 만들었어. 이걸 그대로 다른 이미지 생성기에 넣어도 돼.");
});

copyPrompt.addEventListener("click", async () => {
  await refreshPrompt();
  await navigator.clipboard.writeText(lastPrompt);
  setLog("프롬프트 복사했어.");
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
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: getOAuthOptions(provider),
    });
    if (error) setLog(`로그인 시작 실패: ${error.message}`, "error");
  });
});

signOut.addEventListener("click", async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
  currentUser = null;
  setAuthUi("로그아웃했어.");
  renderDiaryEntries([]);
});

refreshDiary.addEventListener("click", loadDiaryEntries);

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

  const { data: publicUrlData } = supabase.storage.from("diary-images").getPublicUrl(path);
  const insert = await supabase.from("diary_entries").insert({
    user_id: currentUser.id,
    diary_date: data.date || "",
    weather: data.weather || "",
    title: data.title || "그림일기",
    child: data.child || "",
    place: data.place || "",
    diary_text: data.diary || "",
    detail: data.detail || "",
    image_url: publicUrlData.publicUrl,
    image_format: currentImageFormat,
    prompt: lastPrompt || "",
  });

  saveDiary.disabled = false;
  if (insert.error) {
    setLog(`일기 저장 실패: ${insert.error.message}`, "error");
    return;
  }

  setLog("일기장에 저장했어.");
  await loadDiaryEntries();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateRequiredInputs()) return;
  await refreshPrompt();

  loading.classList.remove("hidden");
  generateBtn.disabled = true;
  promptOnly.disabled = true;
  setLog("사진이 있으면 참고해서, 없으면 일기 내용만 보고 그림일기로 만드는 중이야.");

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData()),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "생성 실패");

    setCurrentImage(json.image, formData().outputFormat || "png");
    lastGeneratedInput = formData();
    lastPrompt = json.prompt || lastPrompt;
    promptPreview.textContent = lastPrompt;
    setLog(`완료됐어. 모드: ${json.mode}, 모델: ${json.model}`);
  } catch (error) {
    setLog(error.message || "오류가 났어.", "error");
  } finally {
    loading.classList.add("hidden");
    generateBtn.disabled = false;
    promptOnly.disabled = false;
  }
});

setCurrentImage(currentImageUrl, currentImageFormat);
checkHealth();
refreshPrompt();
initAuth();
