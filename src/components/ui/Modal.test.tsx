import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";

afterEach(cleanup);

it("keeps focus while updating the close handler and Escape policy", () => {
  const initial = vi.fn(), updated = vi.fn();
  const { rerender } = render(<Modal open onClose={initial} title="Edit"><input aria-label="Title" /></Modal>);
  const input = screen.getByRole("textbox");
  input.focus();
  rerender(<Modal open onClose={updated} title="Edit"><input aria-label="Title" /></Modal>);
  expect(input).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(initial).not.toHaveBeenCalled();
  expect(updated).toHaveBeenCalledTimes(1);
  rerender(<Modal open onClose={updated} closeOnEsc={false} title="Edit"><input aria-label="Title" /></Modal>);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(updated).toHaveBeenCalledTimes(1);
});
