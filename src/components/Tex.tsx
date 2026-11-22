import katex from 'katex';
import { memo, useMemo } from 'react';

/** Typeset a LaTeX string with KaTeX. */
export const Tex = memo(function Tex({ tex, block, className }: { tex: string; block?: boolean; className?: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: !!block, throwOnError: false, strict: false });
    } catch {
      return tex;
    }
  }, [tex, block]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});
