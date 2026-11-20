(() => {
  const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));
  const galleryGrid = document.getElementById("gallery-grid");
  const shotCards = Array.from(document.querySelectorAll(".shot-card[data-view]"));

  for (const btn of filterButtons) {
    btn.addEventListener("click", () => {
      const selected = btn.getAttribute("data-filter") || "all";
      for (const other of filterButtons) {
        const active = other === btn;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-selected", active ? "true" : "false");
      }
      for (const card of shotCards) {
        const matches = selected === "all" || card.getAttribute("data-view") === selected;
        card.hidden = !matches;
      }
      if (galleryGrid) {
        galleryGrid.classList.toggle("is-single", selected !== "all");
      }
    });
  }

  const copyButtons = Array.from(document.querySelectorAll("[data-copy]"));
  for (const btn of copyButtons) {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy");
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        const prev = btn.textContent;
        btn.textContent = "Copied";
        btn.classList.add("is-copied");
        window.setTimeout(() => {
          btn.textContent = prev;
          btn.classList.remove("is-copied");
        }, 1600);
      } catch {
        btn.textContent = "Failed";
      }
    });
  }

  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxTitle = document.getElementById("lightbox-title");
  const lightboxCaption = document.getElementById("lightbox-caption");
  const lightboxClose = document.getElementById("lightbox-close");
  const triggers = Array.from(document.querySelectorAll("[data-lightbox-src]"));

  if (lightbox instanceof HTMLDialogElement && lightboxImg instanceof HTMLImageElement) {
    for (const trigger of triggers) {
      trigger.addEventListener("click", () => {
        const src = trigger.getAttribute("data-lightbox-src");
        const title = trigger.getAttribute("data-lightbox-title") || "";
        const caption = trigger.getAttribute("data-lightbox-caption") || "";
        const innerImg = trigger.querySelector("img");
        if (!src) return;
        lightboxImg.src = src;
        lightboxImg.alt = innerImg ? innerImg.alt : title;
        if (lightboxTitle) lightboxTitle.textContent = title;
        if (lightboxCaption) lightboxCaption.textContent = caption;
        lightbox.showModal();
      });
    }

    if (lightboxClose) {
      lightboxClose.addEventListener("click", () => lightbox.close());
    }

    lightbox.addEventListener("close", () => {
      lightboxImg.removeAttribute("src");
    });

    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) {
        lightbox.close();
      }
    });
  }
})();
