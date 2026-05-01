const shareTargets = {
  x: ({ text, url }) =>
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  threads: ({ text, url }) =>
    `https://www.threads.net/intent/post?text=${encodeURIComponent(`${text} ${url}`)}`,
};

export function createImageFilename(format = "png", now = Date.now()) {
  const extension = String(format || "png").replace(/^\./, "");
  return `picture-diary-${now}.${extension}`;
}

export function getSharePageUrl(location = globalThis.location) {
  return `${location.origin}${location.pathname}`;
}

export function buildSocialShareUrl(target, { text, url }) {
  const builder = shareTargets[target];
  if (!builder) throw new Error("지원하지 않는 공유 대상입니다.");
  return builder({ text, url });
}

export async function createImageFileFromDataUrl(dataUrl, filename) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("공유할 수 있는 생성 이미지가 아닙니다.");

  const mime = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: mime });
  if (typeof File === "function") {
    return new File([blob], filename, { type: mime });
  }

  return Object.assign(blob, { name: filename, lastModified: Date.now() });
}
