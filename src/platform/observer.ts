export type AddedNodeHandler = (nodes: Element[], root: ParentNode) => void;

export function observeAddedElements(root: Element, onAdded: AddedNodeHandler): () => void {
  const observer = new MutationObserver((mutations) => {
    const added: Element[] = [];

    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) {
          added.push(node);
        }
      }
    }

    if (added.length > 0) {
      onAdded(added, root);
    }
  });

  observer.observe(root, {
    childList: true,
    subtree: true
  });

  return () => observer.disconnect();
}
