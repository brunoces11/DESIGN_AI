export type LayoutInput = {
  canvas: { widthMm: number; heightMm: number };
  background: { dataUrl: string }; // data:image/png;base64,...
  textElements: TextElement[];
};

export type TextElement = {
  id: string;
  content: string;
  position: { xMm: number; yMm: number };
  size: { widthMm: number; heightMm: number };
  typography: {
    fontFamily: string;
    fontSizePx: number;
    fontWeight: number;
    color: string; // CSS color: '#RRGGBB' ou nome
    align: 'left' | 'center' | 'right';
  };
};

export type JobStatus =
  | 'created'
  | 'iterating'
  | 'processing_step4'
  | 'preview_ready'
  | 'rendering_pdf'
  | 'pdf_ready'
  | 'error';
