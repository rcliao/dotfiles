;; disable emacs ui elements to be minimal for terminal usage
(setq inhibit-startup-message t)
(setq ns-auto-hide-menu-bar t)
(menu-bar-mode -1)

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

;; common packages (evil for vim keybinding - since I'm mostly vim user)
(straight-use-package 'evil)
(straight-use-package 'evil-collection)
;; common packages (ivy/counsel for file finding)
(straight-use-package 'counsel)
(straight-use-package 'ivy)
(straight-use-package 'xclip)
;; org modes
(straight-use-package 'org)
;; temp commented out to use org mode as it is
;;(straight-use-package 'org-roam)
;;(straight-use-package 'org-tree-slide)
;;(straight-use-package 'org-contrib)
;; visual improvements
(straight-use-package 'nord-theme)
(straight-use-package 'doom-modeline)

(doom-modeline-mode 1)

;; overwriting evil mode tab key plugin
(setq evil-want-C-i-jump nil)
(setq evil-want-C-u-scroll 1)
(setq evil-auto-indent nil)
(setq evil-want-keybinding nil)

;; Enable Evil
(require 'evil)
(evil-mode 1)
(evil-collection-init)

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

;; org-mode settings
(setq org-directory "~/org")
(setq org-agenda-files (list "inbox.org" "gtd.org"))
(setq org-ellipsis " >")
(setq org-log-done 'time)
(setq org-log-into-drawer t)
(setq org-agenda-start-with-log-mode t) ;; start with logs with what you are working on
(setq org-agenda-window-steup 'otherwindow)

(setq org-capture-templates
      `(("i" "Inbox" entry  (file+headline "inbox.org" "Inbox")
        ,(concat "* TODO %?\n"
                 "CAPUTRED:/ %U"))))
(setq org-log-done 'time)

;; set up easy key for capture inbox
(defun org-capture-inbox ()
  (interactive)
  (org-capture nil "i"))
(global-set-key (kbd "C-c i") 'org-capture-inbox)

;; TODO keyword highlights
(setq org-todo-keywords
      '((sequence "TODO(t)" "NEXT(n)" "HOLD(h)" "|" "DONE(d)")))

;; org-agenda settings
(setq org-agenda-hide-tags-regexp ".")
(setq org-agenda-prefix-format
      '((agenda . " %i %-12:c%?-12t% s")
        (todo   . " ")
        (tags   . " %i %-12:c")
        (search . " %i %-12:c")))
(setq org-agenda-custom-commands
      '(("g" "Get Things Done (GTD)"
         ((agenda ""
                  ((org-agenda-skip-function
                    '(org-agenda-skip-entry-if 'deadline))
                   (org-deadline-warning-days 0)))
          (todo "NEXT"
                ((org-agenda-skip-function
                  '(org-agenda-skip-entry-if 'deadline))
                 (org-agenda-prefix-format "  %i %-12:c [%e] ")
                 (org-agenda-overriding-header "\nTasks\n")))
          (agenda nil
                  ((org-agenda-entry-types '(:deadline))
                   (org-agenda-format-date "")
                   (org-deadline-warning-days 7)
                   (org-agenda-skip-function
                    '(org-agenda-skip-entry-if 'notregexp "\\* NEXT"))
                   (org-agenda-overriding-header "\nDeadlines")))
          (tags-todo "inbox"
                     ((org-agenda-prefix-format "  %?-12t% s")
                      (org-agenda-overriding-header "\nInbox\n")))
          (tags "CLOSED>=\"<today>\""
                ((org-agenda-overriding-header "\nCompleted today\n")))))))

;; org-refile settings
(setq org-refile-use-outline-path 'file)
(setq org-outline-path-complete-in-steps nil)
(setq org-refile-targets
      '("gtd.org"))
;; Add it after refile
(advice-add 'org-refile :after
        (lambda (&rest _)
          (gtd-save-org-buffers)))

;; org archive
(defun get-current-quarter ()
  "return the current quarter based on the curreht month."
  (let* ((month (string-to-number (format-time-string "%m")))
         (quarter (ceiling (/ month 3.0))))
    (format "Q%d" quarter)))
(setq org-archive-location
      (format "~/org/archives/%s-%s_archive::"
              (format-time-string "%Y") ; year
              (get-current-quarter)))   ; quarter

;; copy and paste in tmux
(require 'xclip)
(xclip-mode 1)
