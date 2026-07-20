import React, { useRef } from 'react';
import { ATTACHMENT_ACCEPT, attachmentKindFromFile, formatFileSize } from './preconMedia.js';

let _key = 0;
function nextKey() {
  _key += 1;
  return `stg_${_key}`;
}

function kindIcon(kind) {
  if (kind === 'image') return '🖼';
  if (kind === 'video') return '🎬';
  if (kind === 'drawing') return '📐';
  return '📄';
}

/**
 * Staged files with display labels before upload.
 * @param {{ items: {key,file,label}[], onChange: (items) => void, disabled?: boolean, compact?: boolean }} props
 */
export function AttachmentPicker({ items, onChange, disabled, compact }) {
  const inputRef = useRef(null);

  const addFiles = (fileList) => {
    const next = [...(items || [])];
    [...(fileList || [])].forEach((file) => {
      const base = file.name.replace(/\.[^.]+$/, '') || file.name;
      next.push({ key: nextKey(), file, label: base });
    });
    onChange(next);
  };

  const updateLabel = (key, label) => {
    onChange((items || []).map((it) => (it.key === key ? { ...it, label } : it)));
  };

  const remove = (key) => {
    onChange((items || []).filter((it) => it.key !== key));
  };

  return (
    <div className={`att-pick${compact ? ' att-pick-compact' : ''}`}>
      <div className="att-pick-head">
        <span className="att-pick-title">Photos, videos, documents & AutoCAD</span>
        <button
          type="button"
          className="att-pick-add"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          + Add files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="att-pick-input"
          disabled={disabled}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <p className="att-pick-hint">
        Name each file (e.g. &quot;Site photo — north elevation&quot;). AutoCAD: .dwg, .dxf, .dwf. Max ~25 MB per file.
      </p>
      {items?.length ? (
        <ul className="att-pick-list">
          {items.map((it) => (
            <li key={it.key} className="att-pick-item">
              <span className={`att-kind att-kind-${attachmentKindFromFile(it.file)}`} aria-hidden>
                {kindIcon(attachmentKindFromFile(it.file))}
              </span>
              <div className="att-pick-fields">
                <input
                  type="text"
                  className="cform-inp"
                  value={it.label}
                  disabled={disabled}
                  placeholder="Document / photo name"
                  onChange={(e) => updateLabel(it.key, e.target.value)}
                />
                <span className="att-pick-meta">
                  {it.file.name} · {formatFileSize(it.file.size)}
                </span>
              </div>
              <button type="button" className="att-pick-rm" disabled={disabled} onClick={() => remove(it.key)} title="Remove">
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="att-pick-empty">No files attached yet</p>
      )}
    </div>
  );
}

export function AttachmentLinks({ attachments }) {
  if (!attachments?.length) return null;
  return (
    <ul className="att-links">
      {attachments.map((a) => (
        <li key={a.id || a.url}>
          <a href={a.url || `#`} target="_blank" rel="noopener noreferrer" className="att-link">
            <span className={`att-kind att-kind-${a.kind || 'document'}`} aria-hidden>
              {kindIcon(a.kind || 'document')}
            </span>
            <span>{a.label || a.fileName || 'File'}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
