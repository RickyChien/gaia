/* global Service, FtuLauncher, AppWindowManager, focusManager, BaseModule */

'use strict';
(function(exports) {
  /**
   * HomescreenWindowManager manages the show/hide of HomescreenWindow,
   * HomescreenLauncher instances, LandingAppWindow and LandingAppLauncher.
   *
   * @class HomescreenWindowManager
   * @requires HomescreenLauncher
   * @requires LandingAppLauncher
   * @requires Service
   */
  function HomescreenWindowManager() {}

  HomescreenWindowManager.EVENTS = [
    'appswitching',
    'ftuskip',
    'open-app',
    'webapps-launch',
    'appopened',
    'appterminated',
    'activityopened',
    'homescreenopened',
    'homescreenclosed',
    'home',
    'launchapp',
    'homescreen-ready',
    'landing-app-ready'
  ];

  HomescreenWindowManager.SUB_MODULES = [
    'HomescreenLauncher',
    'LandingAppLauncher'
  ];

  HomescreenWindowManager.STATES = [
    'getHomescreen'
  ];

  BaseModule.create(HomescreenWindowManager, {
    DEBUG: false,
    _ftuDone: false,
    _activityCount: 0,
    name: 'HomescreenWindowManager',
    CLASS_NAME: 'HomescreenWindowManager',

    debug: function hwm_debug() {
      if (this.DEBUG) {
        console.log('[' + this.CLASS_NAME + ']' +
          '[' + Service.currentTime() + ']' +
          Array.slice(arguments).concat());
      }
    },

    handleEvent: function hwm_handleEvent(evt) {
      var detail;
      switch(evt.type) {
        case 'appswitching':
          this.getHomescreen().showFadeOverlay();
          this.getHomescreen().fadeOut();
          break;
        case 'ftuskip':
          this._ftuSkipped = true;
          if (this.ready) {
            this.getHomescreen().setVisible(true);
          }
          break;
        case 'open-app':
        case 'webapps-launch':
          detail = evt.detail;
          if (detail.manifestURL === this.homescreenLauncher.manifestURL ||
              detail.manifestURL === this.landingAppLauncher.manifestURL) {
            this.launchHomescreen(evt, detail.manifestURL);
            evt.stopPropagation();
            evt.stopImmediatePropagation();
            evt.preventDefault();
          }
          break;
        case 'appopened':
          detail = evt.detail;
          if (detail.manifestURL === FtuLauncher.getFtuManifestURL()) {
            // we don't need to set activeHome as anything if it is ftu.
            break;
          } else if (detail.isHomescreen) {
            this._activeHome = ('LandingAppWindow' === detail.CLASS_NAME) ?
                            this.landingAppLauncher : this.homescreenLauncher;
          } else if (detail.manifest && detail.manifest.role === 'search') {
            // XXX: Bug 1124112 - Seamlessly launch search app from home
            // We have to ensure that the search app is fully rendered before
            // closing the home app so defer it by "setTimeout".
            setTimeout(this.closeHomeApp.bind(this));
          } else {
            this.closeHomeApp();
          }
          break;
        case 'appterminated':
          if (this._underlayApp &&
              evt.detail.manifestURL === this._underlayApp.manifestURL) {
            this._underlayApp = null;
          }
          break;
        case 'homescreenclosed':
          if (this._underlayApp) {
            // If we have _underlayApp but another app is launching, we need to
            // close the _underlayApp.
            var underlayAppIdentity = this._underlayApp.isAppLike ?
              this._underlayApp.identity : this._underlayApp.manifestURL;
            var currentApp = AppWindowManager.getActiveApp();
            var currentAppIdentity = currentApp.isAppLike ?
              currentApp.identity : currentApp.manifestURL;
            if (underlayAppIdentity === currentAppIdentity) {
              this.publish('homescreen-underlayopened', this._underlayApp);
              focusManager.focus();
            } else {
              this._underlayApp.close('immediate');
            }
            this._underlayApp = null;
          }
          break;
        case 'launchapp':
          if (this._underlayApp &&
              evt.detail.manifestURL === this._underlayApp.manifestURL &&
              !evt.detail.stayBackground) {

            // The 'appopened' event will not be fired in this case because this
            // app is already opened. AppWindowManager will change the active
            // app to the opening app and trying to close homescreen app through
            // launchapp event. AppTransitionController may find the app is
            // already opened. So, it doesn't dispatch appopened and focus the
            // appWindow.
            //
            // In this case, HomescreenWindowManager will not close and reset
            // _activeHome. We should call closeHomeApp to reset the variable
            // and focus back. switchApp in app window manager will handle
            // home close.

            this._activeHome = null;
          }
          break;
        case 'homescreenopened':
          detail = evt.detail;
          // Landing app is also a homescreen. We need to which one is opened
          // and show/hide the correct homescreen
          if (detail.CLASS_NAME === 'LandingAppWindow') {
            this.setHomescreenVisible(this.homescreenLauncher, false);
            this.setHomescreenVisible(this.landingAppLauncher, true);
          } else if (this.landingAppLauncher.hasLandingApp) {
            this.setHomescreenVisible(this.landingAppLauncher, false);
            this.setHomescreenVisible(this.homescreenLauncher, true);
          }
          break;
        case 'activityopened':
          if (this._activeHome) {
            this._activityCount++;
          }
          break;
        case 'activityclosed':
          if (this._activeHome) {
            this._activityCount--;
          }
          break;
        case 'home':
          if (this._underlayApp && !this.landingAppLauncher.hasLandingApp) {
            // If we don't have landing app, pressing home key should switch
            // between underlayApp and homescreen.
            AppWindowManager.display(this._underlayApp);
          }
          else {
            this.showHomeApp();
          }
          break;
        case 'landing-app-ready':
        case 'homescreen-ready':
          if (this.ready) {
            // remove ready listener when we are ready.
            window.removeEventListener('homescreen-ready', this);
            window.removeEventListener('landing-app-ready', this);

            this.publish('homescreenwindowmanager-ready');
            // The first activeHome is landing app.
            this._activeHome = this.landingAppLauncher.hasLandingApp ?
                          this.landingAppLauncher : this.homescreenLauncher;
            if (this._ftuSkipped && this.landingAppLauncher.hasLandingApp) {
              // If ftu skipped already got, we need to set landing app as
              // visible
              this.setHomescreenVisible(this.homescreenLauncher, false);
              this.setHomescreenVisible(this.landingAppLauncher, true);
            }
          }
          break;
      }
    },

    closeHomeApp: function hwm_closeHomeApp(nextApp) {
      if (!this._activeHome) {
        return;
      }

      this._activeHome.getHomescreen().ensure(true);
      this._activeHome.getHomescreen().setVisible(false);
      this._activeHome.getHomescreen().close('immediate');
      this._activeHome = null;
    },

    showHomeApp: function hwm_showHomeApp() {
      var originApp = AppWindowManager.getActiveApp();
      var homeApp = this.getHomescreen(true);
      if (originApp.instanceID === homeApp.instanceID) {
        // If we open an activity at home and press home, the originApp is home
        // app and the next app is also home app. In this case, we don't need
        // to reopen it again.
        focusManager.focus();
        return;
      }
      homeApp.ready((function() {
        if (originApp.isHomescreen) {
          if (this._underlayApp) {
            this._underlayApp.close('immediate');
            this._underlayApp = null;
          }
          originApp.close('immediate');
          homeApp.open();
        } else {
          this._underlayApp = originApp;
          homeApp.open();
        }
      }).bind(this));
    },

    setHomescreenVisible: function hwm_hideActiveHome(launcher, visible) {
      launcher.getHomescreen().ensure(true);
      // We need to show/hide fade overlay to have wallpaper shown correctly.
      if (visible) {
        launcher.getHomescreen().showFadeOverlay();
      } else {
        launcher.getHomescreen().hideFadeOverlay();
      }
      launcher.getHomescreen().setVisible(visible);
    },

    publish: function awm_publish(event, detail) {
      var evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(event, true, false, detail || this);

      this.debug('publish: ' + event);
      window.dispatchEvent(evt);
    },

    launchHomescreen: function launchHomescreen(evt, manifestURL) {
      if (!this.landingAppLauncher.hasLandingApp) {
        // cal getHomescreen to ensure it.
        this.getHomescreen();
        this.publish('home');
        return;
      }

      if (this._activeHome) {
        if (this._activeHome.manifestURL !== manifestURL) {
          // in homeA trying to switch to homeB
          this.publish('home');
        } else {
          // cal getHomescreen to ensure it.
          this.getHomescreen();
        }
      } else if (this.homescreenLauncher.manifestURL === manifestURL) {
        // in appX trying to switch to home
        this.publish('home');
      } else if (this.landingAppLauncher.manifestURL === manifestURL) {
        // We set the activeHome as normal home and use home event to switch to
        // landing app
        this._activeHome = this.homescreenLauncher;
        this.publish('home');
      }
    },

    handleHomeEvent: function handleHomeEvent() {
      // If press home when one home app active, we need to swap the
      // launcher.
      if (this._activityCount > 0) {
        // If we have activity on top of home, we need to ensure it to close
        // all of them.
        this._activeHome.getHomescreen().ensure(true);
        if (this._activeHome === this.landingAppLauncher) {
          this._activeHome.getHomescreen().setVisible(false);
          this._activeHome.getHomescreen().close('immediate');
          this._activeHome = this.homescreenLauncher;
        }
        this._activityCount = 0;
      } else {
        this._activeHome.getHomescreen().setVisible(false);
        this._activeHome.getHomescreen().close('immediate');
        // If we have activity on top of home, we always normal home
        this._activeHome = this._activeHome === this.landingAppLauncher ?
                           this.homescreenLauncher : this.landingAppLauncher;
      }
    },

    /**
     * getHomescreen returns the homescreen app window based on if it is
     * triggered by home event.
     *
     * @memberOf HomescreenWindowManager.prototype
     */
    getHomescreen: function getHomescreen(isHomeEvent) {
      if ((!this.homescreenLauncher || !this.homescreenLauncher.ready) &&
          (!this.landingAppLauncher || !this.landingAppLauncher.ready)) {
        return null;
      }

      if (this.landingAppLauncher.hasLandingApp) {

        // use landing app launcher as first home launcher
        if (!this._activeHome) {
          // If this._activeHome is null, the active app is normal app. We need
          // to show normal homescreen app.
          this._activeHome = this.homescreenLauncher;
        } else if (isHomeEvent) {
          this.handleHomeEvent();
        }
      } else if (!this._activeHome) {
        // If we don't have landing app, we need to initialize active home as
        // homescreen launcher.
        this._activeHome = this.homescreenLauncher;
      }

      var home = this._activeHome.getHomescreen(true);
      if (isHomeEvent) {
        home.ensure(true);
      }
      return home;
    }
  }, {
     /**
     * Homescreen Window Manager depends on the ready state of homescreen
     * launcher. It is ready only when all of the homescreen launchers are
     * ready.
     *
     * @access public
     * @memberOf HomescreenWindowManager.prototype
     * @type {boolean}
     */
    ready: {
      enumerable: true,
      get: function ready() {
        return this.homescreenLauncher && this.homescreenLauncher.ready &&
               this.landingAppLauncher && this.landingAppLauncher.ready;
      },
    }
  });

  exports.HomescreenWindowManager = HomescreenWindowManager;
}(window));
