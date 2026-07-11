import React from 'react';

/** Mic toggle for Web Speech dictation. */
export function SpeechDictationButton({
  fieldId,
  activeField,
  listening,
  supported,
  disabled,
  onToggle,
  titleListening = 'Stop dictation',
  titleIdle = 'Dictate with microphone',
}) {
  if (!supported) {
    return (
      <button
        type="button"
        className="cform-mic cform-mic-off"
        disabled
        title="Voice dictation needs Chrome or Edge"
      >
        🎤
      </button>
    );
  }

  const on = listening && activeField === fieldId;
  return (
    <button
      type="button"
      className={`cform-mic${on ? ' cform-mic-on' : ''}`}
      disabled={disabled}
      aria-pressed={on}
      title={on ? titleListening : titleIdle}
      onClick={(e) => {
        e.preventDefault();
        onToggle(fieldId);
      }}
    >
      {on ? '⏹' : '🎤'}
      <span className="cform-mic-lbl">{on ? 'Listening…' : 'Voice'}</span>
    </button>
  );
}
