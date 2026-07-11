import { useCallback, useEffect, useRef, useState } from 'react';

function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function speechDictationSupported() {
  return !!getSpeechRecognitionCtor();
}

function joinTranscript(base, chunk) {
  const a = String(base || '').replace(/\s+$/, '');
  const b = String(chunk || '').trim();
  if (!b) return a;
  if (!a) return b;
  const needsSpace = !/[\s([{/]$/.test(a) && !/^[.,!?;:)\]}]/.test(b);
  return needsSpace ? `${a} ${b}` : `${a}${b}`;
}

/**
 * Continuous Web Speech dictation for one text field at a time.
 * Appends final results; exposes interim text for live preview.
 */
export function useSpeechDictation({ onFinal, lang = 'en-IN', disabled = false } = {}) {
  const [supported] = useState(() => speechDictationSupported());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [activeField, setActiveField] = useState(null);

  const recogRef = useRef(null);
  const wantListenRef = useRef(false);
  const fieldRef = useRef(null);
  const onFinalRef = useRef(onFinal);
  const restartTimerRef = useRef(null);

  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const clearRestart = () => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const stop = useCallback(() => {
    wantListenRef.current = false;
    clearRestart();
    const r = recogRef.current;
    recogRef.current = null;
    fieldRef.current = null;
    setActiveField(null);
    setListening(false);
    setInterim('');
    if (r) {
      try {
        r.onend = null;
        r.onerror = null;
        r.onresult = null;
        r.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    if (disabled && wantListenRef.current) stop();
  }, [disabled, stop]);

  const start = useCallback(
    (fieldId) => {
      if (disabled) return;
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setError('Voice dictation needs Chrome or Edge on this device.');
        return;
      }

      stop();
      setError('');
      wantListenRef.current = true;
      fieldRef.current = fieldId;
      setActiveField(fieldId);

      const startOnce = () => {
        if (!wantListenRef.current) return;
        const recog = new Ctor();
        recogRef.current = recog;
        recog.continuous = true;
        recog.interimResults = true;
        recog.maxAlternatives = 1;
        recog.lang = lang;

        recog.onstart = () => {
          if (wantListenRef.current) setListening(true);
        };

        recog.onresult = (event) => {
          let finals = '';
          let inter = '';
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const res = event.results[i];
            const piece = res?.[0]?.transcript || '';
            if (res.isFinal) finals += piece;
            else inter += piece;
          }
          if (finals.trim()) {
            const field = fieldRef.current;
            onFinalRef.current?.(field, finals);
            setInterim('');
          } else {
            setInterim(inter);
          }
        };

        recog.onerror = (event) => {
          const code = event?.error || 'error';
          if (code === 'aborted' || code === 'no-speech') return;
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            setError('Microphone blocked — allow mic access for this site.');
            wantListenRef.current = false;
            setListening(false);
            setActiveField(null);
            return;
          }
          if (code === 'network') {
            setError('Speech service unavailable (network). Try again.');
            return;
          }
          setError(`Speech error: ${code}`);
        };

        recog.onend = () => {
          recogRef.current = null;
          if (!wantListenRef.current) {
            setListening(false);
            setInterim('');
            setActiveField(null);
            return;
          }
          // Chrome often ends after a pause — auto-restart while user still wants mic on.
          clearRestart();
          restartTimerRef.current = setTimeout(() => {
            if (wantListenRef.current) startOnce();
          }, 180);
        };

        try {
          recog.start();
        } catch (e) {
          setError(e?.message || 'Could not start microphone');
          wantListenRef.current = false;
          setListening(false);
          setActiveField(null);
        }
      };

      startOnce();
    },
    [disabled, lang, stop],
  );

  const toggle = useCallback(
    (fieldId) => {
      if (listening && activeField === fieldId) stop();
      else start(fieldId);
    },
    [listening, activeField, start, stop],
  );

  const clearError = useCallback(() => setError(''), []);

  return {
    supported,
    listening,
    interim,
    error,
    activeField,
    start,
    stop,
    toggle,
    clearError,
  };
}

export { joinTranscript };
