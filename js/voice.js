// Spoken directions with the Web Speech API (speechSynthesis).
//
// Most current browsers have speechSynthesis. If a browser does not have it,
// canSpeak is false and the app hides the button.

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

// The number of the newest call to speak(). A cancelled utterance can end
// after a new call starts. Its callbacks then do nothing.
let current = 0;

// Speak the sentences in order. onSentence(i) runs when sentence i starts, and
// onSentence(-1) runs at the end or on an error. It does not run after stopSpeaking().
export function speak(sentences, onSentence = () => {}) {
  if (!canSpeak) {
    return;
  }
  stopSpeaking();
  const call = ++current;
  const report = (i) => {
    if (call === current) onSentence(i);
  };
  sentences.forEach((text, i) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.onstart = () => report(i);
    if (i === sentences.length - 1) {
      utterance.onend = () => report(-1);
    }
    utterance.onerror = () => report(-1);
    speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking() {
  if (canSpeak) {
    current += 1;
    speechSynthesis.cancel();
  }
}
