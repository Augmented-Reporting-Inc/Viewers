import React, { useEffect, useRef, useState } from 'react';

type MultilineTextDialogProps = {
  hide: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
  placeholder?: string;
  defaultValue?: string;
  helperText?: string;
  saveLabel?: string;
};

function MultilineTextDialog({
  hide,
  onCancel,
  onSave,
  placeholder = '',
  defaultValue = '',
  helperText = '',
  saveLabel = 'Save',
}: MultilineTextDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(value.length, value.length);
  }, []);

  const cancel = () => {
    onCancel();
    hide();
  };

  const save = () => {
    if (!value.trim()) {
      return;
    }

    onSave(value);
    hide();
  };

  return (
    <div className="flex w-[42rem] max-w-[80vw] flex-col gap-3">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
            return;
          }

          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            save();
          }
        }}
        rows={7}
        placeholder={placeholder}
        className="min-h-36 w-full resize-y rounded border border-gray-600 bg-black p-3 text-sm leading-5 text-white outline-none focus:border-blue-400"
        data-cy="multiline-annotation-input"
      />

      {helperText ? <div className="text-xs text-gray-400">{helperText}</div> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded border border-gray-600 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800"
          onClick={cancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!value.trim()}
          onClick={save}
          data-cy="multiline-annotation-save-button"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

export async function callMultilineTextDialog({
  uiDialogService,
  title = 'Annotation',
  placeholder = '',
  defaultValue = '',
  helperText = '',
  saveLabel = 'Save',
}: {
  uiDialogService: AppTypes.UIDialogService;
  title?: string;
  placeholder?: string;
  defaultValue?: string;
  helperText?: string;
  saveLabel?: string;
}): Promise<string | undefined> {
  const dialogId = 'ar-multiline-annotation-dialog';

  return new Promise(resolve => {
    let settled = false;

    const finish = (value?: string) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    };

    uiDialogService.show({
      id: dialogId,
      content: MultilineTextDialog,
      title,
      shouldCloseOnEsc: false,
      contentProps: {
        placeholder,
        defaultValue,
        helperText,
        saveLabel,
        onSave: value => finish(value),
        onCancel: () => finish(undefined),
      },
    });
  });
}

export default callMultilineTextDialog;
