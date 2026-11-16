import { cn } from "@/lib/utils";

/** Converte a formatação do WhatsApp (*negrito*, _itálico_, ~riscado~) em HTML seguro. */
function waToHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<strong>$2</strong>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:;]|$)/g, "$1<s>$2</s>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer" class="text-[#027eb5] underline-offset-2 hover:underline break-all">$1</a>');
}

export function WaPreview({
  text,
  image,
  className,
  time = "12:00",
}: {
  text: string;
  image?: string | null;
  className?: string;
  time?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-[#efeae2] p-4 dark:bg-[#0b141a]",
        "bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.05)_1px,transparent_0)] [background-size:14px_14px]",
        className,
      )}
    >
      <div className="ml-auto w-fit max-w-[92%] rounded-xl rounded-tr-sm bg-[#d9fdd3] p-1 text-[13.5px] leading-[1.45] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:bg-[#005c4b] dark:text-[#e9edef]">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="mb-1 max-h-64 w-full rounded-lg object-cover" />
        ) : null}
        <div className="px-2 pt-1 pb-0.5">
          {text ? (
            <div className="wa-text" dangerouslySetInnerHTML={{ __html: waToHtml(text) }} />
          ) : (
            <div className="text-[#667781] italic">Sem conteúdo</div>
          )}
          <div className="mt-0.5 text-right text-[10.5px] text-[#667781] dark:text-[#8696a0]">{time} ✓✓</div>
        </div>
      </div>
    </div>
  );
}
