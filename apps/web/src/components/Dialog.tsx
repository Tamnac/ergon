import { createEffect, type JSX } from 'solid-js';
import { IconButton } from './Icon';
import './Dialog.css';

export function Dialog(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  let dialog!: HTMLDialogElement;

  createEffect(() => {
    if (props.open && !dialog.open) dialog.showModal();
    else if (!props.open && dialog.open) dialog.close();
  });

  return (
    <dialog
      ref={dialog}
      class="dialog"
      aria-label={props.title}
      onClose={() => props.onClose()}
      onClick={(event) => {
        if (event.target === dialog) dialog.close();
      }}
    >
      <header class="dialog-header">
        <h2 class="dialog-title">{props.title}</h2>
        <IconButton icon="close" label="Close" onClick={() => dialog.close()} />
      </header>
      <div class="dialog-body">{props.children}</div>
    </dialog>
  );
}
