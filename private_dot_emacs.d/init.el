;; disable menu bar in terminal
(menu-bar-mode -1)

;; setting up straight.el https://github.com/raxod502/straight.el
(defvar bootstrap-version)
(let ((bootstrap-file
       (expand-file-name "straight/repos/straight.el/bootstrap.el" user-emacs-directory))
      (bootstrap-version 5))
  (unless (file-exists-p bootstrap-file)
    (with-current-buffer
        (url-retrieve-synchronously
         "https://raw.githubusercontent.com/raxod502/straight.el/develop/install.el"
         'silent 'inhibit-cookies)
      (goto-char (point-max))
      (eval-print-last-sexp)))
  (load bootstrap-file nil 'nomessage))
(setq package-enable-at-startup nil)

(add-to-list 'custom-theme-load-path (expand-file-name "~/.emacs.d/themes/"))

(straight-use-package 'evil)
(straight-use-package 'helm)
(straight-use-package 'nord-theme)

;; overwriting evil mode tab key plugin
(setq evil-want-C-i-jump nil)

;; Enable Evil
(require 'evil)
(evil-mode 1)

(custom-set-variables
 ;; custom-set-variables was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
 '(package-selected-packages '(nord-theme evil)))

;; enable nord theme
(load-theme 'nord t)

;; keybind
(global-set-key (kbd "C-c l") 'org-store-link)
(global-set-key (kbd "C-c a") 'org-agenda)
(global-set-key (kbd "C-c c") 'org-capture)
(global-set-key (kbd "C-c f") 'helm-find-files)
(global-set-key (kbd "C-c b") 'helm-buffers-list)

;; org-mode settings
(setq org-agenda-files '("~/Dropbox/journals/org"))
