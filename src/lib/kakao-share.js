const KAKAO_SDK_URL = "https://t1.kakaocdn.net/kakao_js_sdk/2.8.0/kakao.min.js";

let kakaoSdkPromise;

function loadScript() {
  if (globalThis.Kakao) return Promise.resolve(globalThis.Kakao);
  if (!kakaoSdkPromise) {
    kakaoSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = KAKAO_SDK_URL;
      script.async = true;
      script.onload = () => resolve(globalThis.Kakao);
      script.onerror = () => reject(new Error("카카오 공유 SDK를 불러오지 못했어요."));
      document.head.appendChild(script);
    });
  }
  return kakaoSdkPromise;
}

export async function shareKakaoInvite({ javaScriptKey, title, text, url }) {
  if (!javaScriptKey) throw new Error("KAKAO_JAVASCRIPT_KEY가 필요해요.");
  const Kakao = await loadScript();
  if (!Kakao) throw new Error("카카오 공유 SDK를 사용할 수 없어요.");
  if (!Kakao.isInitialized()) Kakao.init(javaScriptKey);
  Kakao.Share.sendDefault({
    objectType: "text",
    text,
    link: {
      mobileWebUrl: url,
      webUrl: url,
    },
    buttonTitle: "그림일기장 들어가기",
    installTalk: true,
    serverCallbackArgs: {
      shareType: "diary-book-invite",
      title,
    },
  });
}
