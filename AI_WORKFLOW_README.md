# AI Development Workflow

This repository uses Git submodules. An AI-assisted fix or feature must be
developed and reviewed in the repository that owns its source code before the
parent `DesktopEditors` repository records the new submodule revisions.

## 1. Develop on dedicated submodule branches

- Create a separate branch for **each fix or feature** in every affected
  submodule, starting from that submodule's `typsastra-rebrand` branch. Use a
  descriptive name such as `fix/pdf-search-spans` or
  `feature/khmer-spellcheck`.
- For changes spanning multiple submodules, use a dedicated branch in **each**
  affected submodule. Commits and merges stay in their respective repositories;
  a submodule commit cannot be merged into a different submodule.
- Keep unrelated changes out of the branch. Preserve other in-progress work in
  the working tree and stage only the files belonging to the fix or feature.
- Build and run relevant checks, then report the behavior verified and any
  remaining limitations. Share the branch and commit references for review.
- Do not make development commits on a submodule's `master` branch.

## 2. Promote approved changes within each submodule

- Wait for **user approval of the fix or feature** before merging its branch
  into that submodule's `typsastra-rebrand` branch or pushing that integration.
- Confirm that the proposed merge contains only the approved work. If the
  feature branch has unrelated ancestry, bring over only the approved commits.
- Merge or fast-forward the approved branch into `typsastra-rebrand`, run the
  relevant checks, and push `typsastra-rebrand` to that submodule's remote.
- Leave submodule `master` branches untouched. An approved change to one
  submodule does not authorize promotion of changes in another.

## 3. Update DesktopEditors master after separate approval

- Wait for **user approval to update `DesktopEditors` `master`** after the
  affected submodules' `typsastra-rebrand` branches contain the approved work.
- In the parent repository, stage only the intended submodule gitlinks (and
  any explicitly approved parent-repository files). These gitlinks must point
  to the approved commits on the respective submodules' `typsastra-rebrand`
  branches.
- Review the staged diff to ensure no unrelated submodule pointer, dirty
  working-tree change, generated file, or unapproved feature is included.
- Commit the pin updates on `DesktopEditors` `master` and push only after that
  approval. Record the parent commit and the exact submodule commits in the
  completion summary.

**Approval sequence:** dedicated branches → user approves each change →
submodule `typsastra-rebrand` branches → user approves integration →
`DesktopEditors` `master` pins. Never promote work by changing a submodule's
`master` branch.
