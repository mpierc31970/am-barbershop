// @vitest-environment jsdom
// 07-23: LinkPasteField (CONT-17, CONT-34, D281; 07-UI-SPEC "Column items", "Interaction
// states" Link paste field): result card, exact refusal copy, Play preview from
// consentFrameUrl only, never a provider thumbnail.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_NOT_ALLOWED_COPY,
  EMBED_NOT_ALLOWED_COPY,
  FRAME_ALLOW,
  LINK_NOT_ALLOWED_COPY,
  consentFrameUrl,
  type MediaLink,
  type MediaLinkCategory,
} from "@cds/core/content";
import { LinkPasteField } from "./LinkPasteField";
import {
  button,
  click,
  mount,
  typeInto,
  type Mounted,
} from "../test-support/dom";

const YT = "dQw4w9WgXcQ";
let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function setup(
  category: MediaLinkCategory,
  extra: Partial<Parameters<typeof LinkPasteField>[0]> = {},
) {
  const onChange = vi.fn<(link: MediaLink | null) => void>();
  mounted = mount(
    <LinkPasteField
      id="lp"
      label="Paste a link"
      helper="Paste the address from your browser"
      category={category}
      provider=""
      providerId=""
      onChange={onChange}
      {...extra}
    />,
  );
  const root = mounted.container;
  const input = root.querySelector<HTMLInputElement>("#lp")!;
  const status = () => root.querySelector('[role="status"]')?.textContent ?? "";
  const described = () =>
    (input.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .map((id) => (id ? document.getElementById(id)?.textContent : ""))
      .join(" ");
  return { root, input, onChange, status, described };
}

describe("LinkPasteField (video)", () => {
  it("a YouTube link shows the result card with the page link and Play preview", () => {
    const { root, input, onChange, status } = setup("video");
    typeInto(input, `https://youtu.be/${YT}`);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: "youtube", id: YT }),
    );
    expect(status()).toBe("YouTube video found");
    expect(root.querySelector('[role="status"] svg')).not.toBeNull();
    const open = Array.from(root.querySelectorAll("a")).find(
      (a) => a.textContent === "Open on YouTube",
    )!;
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    expect(button(root, "Play preview")).not.toBeNull();
    expect(root.querySelector("iframe")).toBeNull();
    expect(root.innerHTML).not.toContain("i.ytimg.com");
    expect(root.querySelector("img")).toBeNull();
  });

  it("shows only our stored cover thumb", () => {
    const { root, input } = setup("video", {
      coverThumbUrl: "/hub/media/c1/thumb",
      coverNote: "Note here",
    });
    typeInto(input, `https://youtu.be/${YT}`);
    const img = root.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/hub/media/c1/thumb");
    expect(img.getAttribute("alt")).toBe("");
    expect(root.textContent).toContain("Note here");
    expect(root.innerHTML).not.toContain("i.ytimg.com");
  });

  it("Play preview loads one iframe from consentFrameUrl; Hide preview removes it", () => {
    const { root, input } = setup("video");
    typeInto(input, `https://youtu.be/${YT}`);
    click(button(root, "Play preview"));
    const frames = root.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.getAttribute("src")).toBe(
      consentFrameUrl({ kind: "link", provider: "youtube", id: YT }),
    );
    expect(frames[0]!.getAttribute("title")).toBe("Preview: YouTube video");
    expect(frames[0]!.getAttribute("allow")).toBe(FRAME_ALLOW.video);
    click(button(root, "Hide preview"));
    expect(root.querySelector("iframe")).toBeNull();
  });

  it("a pasted Vimeo iframe is found", () => {
    const { input, status } = setup("video");
    typeInto(
      input,
      '<iframe src="https://player.vimeo.com/video/76979871"></iframe>',
    );
    expect(status()).toBe("Vimeo video found");
  });

  it("a lookalike host is refused with LINK-NOT-ALLOWED on the input", () => {
    const { input, onChange, status, described } = setup("video");
    typeInto(input, "https://youtube.com.evil.net/watch?v=x");
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(described()).toContain(LINK_NOT_ALLOWED_COPY);
    expect(status()).toBe("");
  });

  it("a Spotify link in a video field is refused", () => {
    const { input, described } = setup("video");
    typeInto(input, "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
    expect(described()).toContain(LINK_NOT_ALLOWED_COPY);
  });

  it("empty text shows the helper and no error", () => {
    const { input, described } = setup("video");
    typeInto(input, `https://youtu.be/${YT}`);
    typeInto(input, "");
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    expect(described()).toContain("Paste the address from your browser");
  });

  it("an error prop wins over the local message", () => {
    const { input, described } = setup("video", { error: "Server says no." });
    typeInto(input, "https://youtube.com.evil.net/watch?v=x");
    expect(described()).toContain("Server says no.");
    expect(described()).not.toContain(LINK_NOT_ALLOWED_COPY);
  });

  it("starts from the stored link's page URL", () => {
    const { input, status } = setup("video", {
      provider: "vimeo",
      providerId: "76979871",
    });
    expect(input.value).toBe("https://vimeo.com/76979871");
    expect(status()).toBe("Vimeo video found");
  });
});

describe("LinkPasteField (audio and embed)", () => {
  it("audio refuses YouTube and finds Spotify", () => {
    const { input, status, described } = setup("audio");
    typeInto(input, `https://youtu.be/${YT}`);
    expect(described()).toContain(AUDIO_NOT_ALLOWED_COPY);
    typeInto(input, "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
    expect(status()).toBe("Spotify found");
  });

  it("embed refuses YouTube; Calendly previews at 704 px inside a scroll box", () => {
    const { root, input, status, described } = setup("embed");
    typeInto(input, `https://youtu.be/${YT}`);
    expect(described()).toContain(EMBED_NOT_ALLOWED_COPY);
    typeInto(input, "https://calendly.com/acme-studio/30min");
    expect(status()).toBe("Calendly found");
    click(button(root, "Play preview"));
    const frame = root.querySelector("iframe")!;
    expect(frame.getAttribute("height")).toBe("704");
    expect(frame.getAttribute("title")).toBe("Preview: Calendly");
    expect(frame.hasAttribute("allow")).toBe(false);
    expect(frame.parentElement?.className).toContain("max-h-[480px]");
  });
});
