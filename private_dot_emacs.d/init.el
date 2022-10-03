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

;; common packages
(straight-use-package 'evil)
(straight-use-package 'counsel)
(straight-use-package 'ivy)
(straight-use-package 'xclip)
;; org modes
(straight-use-package 'org)
(straight-use-package 'org-roam)
(straight-use-package 'org-tree-slide)
(straight-use-package 'org-contrib)
;; visual improvements
(straight-use-package 'nord-theme)
(straight-use-package 'doom-modeline)

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
(setq org-directory "~/Dropbox/journals/org")
(setq org-agenda-files (list "inbox.org" "agenda.org" "notes.org"))
(setq org-ellipsis " >")
(setq org-agenda-start-with-log-mode t) ;; start with logs with what you are working on
(setq org-log-done 'time)
(setq org-log-into-drawer t)
(require 'ox-md)
(require 'ox-confluence)

(setq org-capture-templates
      `(("i" "Inbox" entry  (file "inbox.org")
        ,(concat "* TODO %?\n"
                 "/Entered on/ %U"))
        ("m" "Meeting" entry  (file+headline "agenda.org" "Future")
        ,(concat "* %? :meeting:\n"
                 "<%<%Y-%m-%d %a %H:00>>"))
        ("n" "Note" entry  (file "notes.org")
        ,(concat "* Note (%a)\n"
                 "/Entered on/ %U\n" "\n" "%?"))))
(setq org-log-done 'time)

;; to open capture mode in full window
(add-hook 'org-capture-mode-hook 'delete-other-windows)

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
      '(("projects.org" :regexp . "\\(?:\\(?:Note\\|Task\\)s\\)")))
(setq org-agenda-files 
      (mapcar 'file-truename 
          (file-expand-wildcards "~/Dropbox/journals/org/*.org")))
;; Save the corresponding buffers
(defun gtd-save-org-buffers ()
  "Save `org-agenda-files' buffers without user confirmation.
See also `org-save-all-org-buffers'"
  (interactive)
  (message "Saving org-agenda-files buffers...")
  (save-some-buffers t (lambda () 
             (when (member (buffer-file-name) org-agenda-files) 
               t)))
  (message "Saving org-agenda-files buffers... done"))

;; Add it after refile
(advice-add 'org-refile :after
        (lambda (&rest _)
          (gtd-save-org-buffers)))

;; copy and paste in tmux
(require 'xclip)
(xclip-mode 1)
