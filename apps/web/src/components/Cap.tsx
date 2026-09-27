import './Cap.css';

/** Text set with a large first letter and the rest small beside it. */
export function Cap(props: { text: string }) {
  const letters = () => Array.from(props.text);
  return (
    <>
      <span class="cap">{letters()[0]}</span>
      <span class="cap-rest">{letters().slice(1).join('')}</span>
    </>
  );
}
