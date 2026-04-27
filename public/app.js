import {
  buildSocialShareUrl,
  createImageFileFromDataUrl,
  createImageFilename,
  getSharePageUrl,
} from "./share-utils.js";

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
const nativeShare = document.querySelector("#nativeShare");
const copyPrompt = document.querySelector("#copyPrompt");
const log = document.querySelector("#log");
const socialShareButtons = document.querySelectorAll("[data-share-target]");

let referenceImageDataUrl = "";
let lastPrompt = "";
let currentImageUrl = resultImage.getAttribute("src") || "/sample-output.png";
let currentImageFormat = "png";
let currentImageFilename = createImageFilename(currentImageFormat);

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

function setLog(message, tone = "normal") {
  log.textContent = message || "";
  log.dataset.tone = tone;
}

function setCurrentImage(url, format = "png") {
  currentImageUrl = url;
  currentImageFormat = format;
  currentImageFilename = createImageFilename(currentImageFormat);
  resultImage.src = currentImageUrl;
  downloadLink.href = currentImageUrl;
  downloadLink.download = currentImageFilename;
  downloadLink.classList.remove("disabled");
}

function shareText() {
  const data = formData();
  const title = data.title || "그림일기";
  return `그림일기 타임머신으로 만든 ${title}`;
}

async function refreshPrompt() {
  const data = formData();
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
  await refreshPrompt();
  setLog("프롬프트만 만들었어. 이걸 그대로 다른 이미지 생성기에 넣어도 돼.");
});

copyPrompt.addEventListener("click", async () => {
  await refreshPrompt();
  await navigator.clipboard.writeText(lastPrompt);
  setLog("프롬프트 복사했어.");
});

nativeShare.addEventListener("click", async () => {
  const pageUrl = getSharePageUrl();
  const baseShareData = {
    title: "그림일기 타임머신",
    text: shareText(),
    url: pageUrl,
  };

  try {
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
  } catch (error) {
    if (error.name === "AbortError") {
      setLog("공유를 취소했어.");
      return;
    }
    await navigator.clipboard.writeText(pageUrl);
    setLog("공유가 막혀서 링크를 복사했어.", "error");
  }
});

socialShareButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.shareTarget;
    const url = buildSocialShareUrl(target, {
      text: shareText(),
      url: getSharePageUrl(),
    });
    window.open(url, "_blank", "noopener,noreferrer,width=720,height=640");
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
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
