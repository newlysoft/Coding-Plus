'use strict';

/* global $, CodingAPI, safeTpl, SHA1, Adminer */

$(function () {

	var allProjects = [],
		notificationUnreadProjects = [];

	var renderProjects = function (prjs) {
		safeTpl.get('project', {projects: prjs}, function (html) {
			$('#project-list').html(html);
		});
	};

	var loadPaasInfo = function (prjs) {
		var count = 0;
		var running = [],
			normal = [];
		$.each(prjs, function (index, prj) {
			CodingAPI.paas(prj.user, prj.name, function (result) {
				if (!result.error) {
					prj.running = true;
					prj.memory = result.memory;
					prj.site = result.url;
					running.push(prj);
				} else {
					normal.push(prj);
				}
				count++;
				if (count === prjs.length) {
					running = Array.prototype.sort.call(running, function (a, b) {
						return a.memory > b.memory ? -1 : 1;
					});
					var all = running.concat(normal);
					allProjects = all;
					renderProjects(all);
				}
			});
		});

	};

	var renderQuickToolbar = function (loading) {
		var count = 0;
		$.each(notificationUnreadProjects, function (i, project) {
			/*jshint camelcase: false */
			count += project.un_read_activities_count;
		});
		safeTpl.get('remove_update_count', {loading: loading || false, count: count>99 ? '99+' : count}, function (html) {
			$('#remove-update-count').html(html);
		});
	};

	var afterLoadProjects = function (projects, callback) {
		if (!projects.code) {
			var prjs = $.map(projects, function (project) {
				/*jshint camelcase: false */
				if (!!project.un_read_activities_count) {
					notificationUnreadProjects.push(project);
				}
				return {
					'user': project.owner_user_name,
					'$.path': project.project_path,
					'$.icon': project.icon,
					'name': project.name,
					'isPrivate': !project.is_public,
					'activityUpdateCount': project.un_read_activities_count || 0
				};
			});
			renderProjects(prjs);
			loadPaasInfo(prjs);
			renderQuickToolbar();
			allProjects = prjs;
			if(callback){
				callback();
			}
		} else {
			safeTpl.get('unlogin_content', {}, function (html) {
				$('#project-list').html(html);
				if(callback){
					callback();
				}
			});
		}
	};

	var loadRemoteProjects = function (callback) {
		CodingAPI.projects('all', function (projects) {
			CodingStorageInstance.set('projects', {projects: projects}, function () {
				afterLoadProjects(projects, callback);
			});
		});
	};

	var loadProjects = function (callback, refresh) {
		if(refresh) {
			loadRemoteProjects(callback);
			return;
		}
		CodingStorageInstance.get('projects', function (data) {
			if(data && data.projects && data.projects.length > 0){
				afterLoadProjects(data.projects, callback);
			}else {
				loadRemoteProjects(callback);
			}
		});
	};

	//toggle project toolbar
	$('#projects').on('click', '.project', function (event) {
		var target = $(event.target);
		if (!target.is('.running') || target.is('.toolbar, .toolbar *')) {
			return;
		}
		var self = $(this);
		var isOpen = self.is('.open');
		$('#projects .project.open').removeClass('open');
		if (!isOpen) {
			self.addClass('open');
		}
	});

	var showDeletePaasDialog = function (project) {
		safeTpl.get('delete_paas_dialog', {project: project}, function (html) {
			$('body').addClass('dimmer').append(html);
			$('#delete-paas-dialog input').focus();
		});
	};

	var hideDeletePaasDialog = function () {
		$('#delete-paas-dialog').remove();
		$('body').removeClass('dimmer');
	};

	var showDeletePaasDialogError = function (msg) {
		var password = $('#delete-paas-dialog .password');
		password.find('.error').html(msg);
		password.addClass('deleting-error');
		setTimeout(hideDeletePaasDialogError, 2000);
	};

	var hideDeletePaasDialogError = function () {
		var password = $('#delete-paas-dialog .password');
		password.removeClass('deleting-error');
	};

	//stop paas
	$('#projects').on('click', '.project .toolbar-item', function () {
		var self = $(this),
			parent = self.parent();
		var action = self.data('action');
		var user = parent.data('user');
		var project = parent.data('project');
		if (action === 'remove') {
			var deletePaas = function (password) {
				CodingAPI.deletePaas(user, project, password, function (result) {
					if (result.error) {
						showDeletePaasDialogError(result.message);
					} else {
						hideDeletePaasDialog();
						loadPaasInfo(allProjects);
					}
				});
			};
			showDeletePaasDialog(project);
			var doDelete = function () {
				var input = $('#delete-paas-dialog input');
				var password = SHA1(input.val());
				deletePaas(password);
			};
			$('body').on('click', '#delete-paas-dialog .delete-paas.button', doDelete);
		} if(action === 'db') {
			if(user !== currentUser.global_key){
				var dialog = new PaasDbDialog('error');
				dialog.show({
					user: user,
					project: project
				});
				return;
			}
			CodingAPI.services(user, project, CodingAPI.SERVICES['mysql'], function (services) {
				if(services.length === 0){
					CodingAPI.avaServices(user, project, CodingAPI.SERVICES['mysql'], function (services) {
						var dialog = new PaasDbDialog('bind');
						dialog.show({
							user: user,
							project: project,
							services: services
						}, function onChoose(service) {
							CodingAPI.bindServiceInstance(user, project, service.id, function () {
								CodingAPI.serviceCredentials(user, project, service.id, function (credentials) {
									Adminer.login(credentials);
								});
							});
						});
					});
				}else{
					var dialog = new PaasDbDialog('choose');
					dialog.show({
						user: user,
						project: project,
						services: services
					}, function onChoose(service) {
						CodingAPI.serviceCredentials(user, project, service.id, function (credentials) {
							Adminer.login(credentials);
						});
					});
				}
			})
		} else {
			var player = CodingAPI.player(user, project);
			player(action, function () {
				loadPaasInfo(allProjects);
			});
		}
	});

	//delete paas dialog event
	$('body').on('click', '#delete-paas-dialog .close', hideDeletePaasDialog);

	//remove project activity count
	$('#remove-update-count').on('click', function () {
		var self = $(this);
		self.addClass('loading');
		renderQuickToolbar(true);
		var ids = $.map(notificationUnreadProjects, function (project) {
			return project.id;
		});
		CodingAPI.removeCount(ids, function () {
			$.each(allProjects, function (i, prj) {
				prj.activityUpdateCount = 0;
			});
			renderProjects(allProjects);
			notificationUnreadProjects = [];
			renderQuickToolbar(false);
			self.removeClass('loading');
		});
	});

	//refresh projects
	$('#refresh-projects').on('click', function () {
		var self = $(this);
		var icon = self.find('i.fa');
		icon.addClass('loading');
		loadProjects(function () {
			icon.removeClass('loading');
		}, true);
	});

	loadProjects();

});