/// <reference types="astro/client" />

declare namespace astroHTML.JSX {
  interface InputHTMLAttributes {
    /** Chromium's directory-upload picker attribute. */
    webkitdirectory?: boolean | string | null;
  }
}
