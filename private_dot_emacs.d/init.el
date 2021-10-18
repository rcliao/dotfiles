;; disable emacs ui elements to be minimal
(setq inhibit-startup-message t)
(setq ns-auto-hide-menu-bar t)
(tool-bar-mode 0)
(menu-bar-mode -1)
(tool-bar-mode -1)
(tooltip-mode -1)
(scroll-bar-mode -1)
(set-fringe-mode 10)

;; wrap long line automatically as I'm typing
(add-hook 'text-mode-hook #'visual-line-mode)

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

;; common packages
(straight-use-package 'evil)
(straight-use-package 'counsel)
(straight-use-package 'ivy)
(straight-use-package 'xclip)
;; visual improvements
(straight-use-package 'nord-theme)
(straight-use-package 'doom-modeline)
;; org modes
(straight-use-package 'org)
(straight-use-package 'org-roam)
(straight-use-package 'org-tree-slide)
(straight-use-package 'org-contrib)

;; doom status bar
(doom-modeline-mode 1)

;; overwriting evil mode tab key plugin
(setq evil-want-C-i-jump nil)
(setq evil-want-C-u-scroll 1)
(setq evil-auto-indent nil)

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

;; enable spellcheck in orgmode
(add-hook 'org-mode-hook 'flyspell-mode)

;; org-roam
(setq org-roam-directory (file-truename "~/Dropbox/journals/org"))
(setq org-roam-v2-ack t)
(org-roam-db-autosync-mode)
(setq org-roam-dailies-directory "~/Dropbox/journals/org/daily/")

;; ivy configuration
(ivy-mode)
(setq ivy-use-virtual-buffers t)
(setq enable-recursive-minibuffers t)
;; enable this if you want `swiper' to use it
;; (setq search-default-mode #'char-fold-to-regexp)
(global-set-key "\C-s" 'swiper)
(global-set-key (kbd "M-x") 'counsel-M-x)
(global-set-key (kbd "C-x C-f") 'counsel-find-file)
(define-key minibuffer-local-map (kbd "C-c C-r") 'counsel-minibuffer-history)

;; keybind
(global-set-key (kbd "C-c l") 'org-store-link)
(global-set-key (kbd "C-c a") 'org-agenda)
(global-set-key (kbd "C-c c") 'org-capture)
;; for presenting org mode articles
(global-set-key (kbd "C-c o p") 'org-tree-slide-mode)
(with-eval-after-load "org-tree-slide"
  (define-key org-tree-slide-mode-map (kbd "C-c k") 'org-tree-slide-move-previous-tree)
  (define-key org-tree-slide-mode-map (kbd "C-c j") 'org-tree-slide-move-next-tree)
  )

;; keybind for org-roam
(global-set-key (kbd "C-c o f") 'org-roam-node-find)
(global-set-key (kbd "C-c o i") 'org-roam-node-insert)
(global-set-key (kbd "C-c o d") 'org-roam-dailies-capture-today)
(global-set-key (kbd "C-c o c d") 'org-roam-dailies-capture-date)
(global-set-key (kbd "C-c o g d") 'org-roam-dailies-goto-date)
(global-set-key (kbd "C-c o g t") 'org-roam-dailies-goto-today)
(global-set-key (kbd "C-c o g y") 'org-roam-dailies-goto-yesterday)

;; org-mode settings
(setq org-agenda-files '("~/Dropbox/journals/org"))
(setq org-ellipsis " >")
(setq org-agenda-start-with-log-mode t) ;; start with logs with what you are working on
(setq org-log-done 'time)
(setq org-log-into-drawer t)
(require 'ox-md)
(require 'ox-confluence)

;; copy and paste in tmux
(require 'xclip)
(xclip-mode 1)
