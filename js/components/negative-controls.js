define(['knockout',
        'text!./negative-controls.html',
        'appConfig',
        'webapi/EvidenceAPI',
        'webapi/CDMResultsAPI',
        'webapi/ConceptSetAPI',
        'ohdsi.util',
        'knockout.dataTables.binding',
        'faceted-datatable',
        'databindings'
], function (ko, view, config, evidenceAPI, cdmResultsAPI, conceptSetAPI) {
    function negativeControls(params) {
        var self = this;

        var pollTimeout = null;
        self.model = params.model;
        self.selectedConcepts = params.selectedConcepts;
        self.conceptSet = params.conceptSet;
        self.conceptIds = params.conceptIds;
        self.services = params.services;
        self.defaultResultsUrl = params.defaultResultsUrl;
        self.negativeControls = params.negativeControls;
        self.dirtyFlag = params.dirtyFlag;
        self.conceptSetValid = ko.observable(false);
        self.conceptDomainId = ko.observable(null);
        self.targetDomainId = ko.observable(null);
        self.currentEvidenceService = ko.observable();
        self.currentResultSource = ko.observable();
        self.loadingResults = ko.observable(false);
        self.evidenceSources = ko.observableArray();
        self.loadingEvidenceSources = ko.observable(false);
        self.isRunning = ko.observable(false);

        self.selectedConceptsSubscription = self.selectedConcepts.subscribe(function (newValue) {
            if (newValue != null) {
                self.evaluateConceptSet();
            }
        });

        self.pollForInfo = function () {
            var hasPending = false;
            self.isRunning(true);

            if (pollTimeout)
                clearTimeout(pollTimeout);

            conceptSetAPI.getGenerationInfo(self.conceptSet().id).then(function (infoList) {
                console.log("poll for negative controls....")

                infoList.forEach(function (info) {
                    var source = self.evidenceSources().filter(function (s) {
                        return s.sourceId() == info.sourceId
                    })[0];

                    if (source) {
                        source.status(info.status);
                        source.isValid(info.isValid);
                        var date = new Date(info.startTime);
                        source.startTime(date.toLocaleDateString() + ' ' + date.toLocaleTimeString());
                        source.executionDuration('...');

                        if (info.status != "COMPLETE") {
                            hasPending = true;
                        } else {
                            source.executionDuration((info.executionDuration / 1000) + 's');
                        }
                    }
                });

                if (hasPending) {
                    pollTimeout = setTimeout(function () {
                        self.pollForInfo();
                    }, 5000);
                } else {
                    self.isRunning(false);
                }

            });
        }

        self.generate = function (service, event) {
            // Check to make sure the concept set is valid before calling the service
            if (!self.conceptSetValid()) {
                alert("The concept set is not marked as valid to generate results. Please make sure this concept set contains only CONDITIONS or DRUGS.");
                return;
            }

            // Call the ajax service to generate the results
            var negativeControlsJob = evidenceAPI.generateNegativeControls(service.sourceKey(), self.conceptSet().id, self.conceptSet().name(), self.conceptDomainId(), self.targetDomainId(), self.conceptIds());

            $.when(negativeControlsJob).done(function(jobInfo) {
               self.isRunning(true);
               pollTimeout = setTimeout(function () {
                        self.pollForInfo();
                    }, 5000);     
            });
        }

        self.isGenerating = function () {
            return false;
        }

        self.evaluateConceptSet = function () {
            // Determine if all of the concepts in the current concept set
            // are all of the same type (CONDITION or DRUG) and if so, this
            // concept set is valid and can be evaluated for negative controls
            var conceptSetValid = false;
            var conceptDomainId = null;
            var targetDomainId = null;
            var conceptSetLength = self.selectedConcepts().length;
            var conditionLength = self.selectedConcepts().filter(function (elem) {
                return elem.concept.DOMAIN_ID == "Condition";
            }).length;
            var drugLength = self.selectedConcepts().filter(function (elem) {
                return elem.concept.DOMAIN_ID == "Drug";
            }).length;

            if (conceptSetLength > 0) {
                if (conditionLength == conceptSetLength) {
                    conceptSetValid = true;
                    conceptDomainId = "Condition";
                    targetDomainId = "Drug";
                } else if (drugLength == conceptSetLength) {
                    conceptSetValid = true;
                    conceptDomainId = "Drug";
                    targetDomainId = "Condition";
                }
            }
            self.conceptSetValid(conceptSetValid);
            self.conceptDomainId(conceptDomainId);
            self.targetDomainId(targetDomainId);
        }

        self.getEvidenceSourcesFromConfig = function () {
            evidenceSources = [];
            $.each(config.services, function (sourceIndex, service) {
                console.log(service);
                $.each(service.sources, function (i, source) {
                    if (source.hasEvidence) {
                        var sourceInfo = {};
                        sourceInfo.sourceId = ko.observable(source.sourceId);
                        sourceInfo.sourceKey = ko.observable(source.sourceKey);
                        sourceInfo.sourceName = ko.observable(source.sourceName);
                        sourceInfo.startTime = ko.observable("n/a");
                        sourceInfo.executionDuration = ko.observable("n/a");
                        sourceInfo.status = ko.observable("n/a");
                        sourceInfo.isValid = ko.observable(false);

                        evidenceSources.push(sourceInfo);
                    }
                })
            });
            return evidenceSources;
        }

        self.getEvidenceSources = function () {
            self.loadingEvidenceSources(true);
            var resolvingPromise = conceptSetAPI.getGenerationInfo(self.conceptSet().id);
            $.when(resolvingPromise).done(function (generationInfo) {
                var evidenceSources = self.getEvidenceSourcesFromConfig();
                $.each(evidenceSources, function (i, evidenceSource) {
                    var gi = $.grep(generationInfo, function (a) {
                        return a.sourceId == evidenceSource.sourceId();
                    });
                    if (gi.length > 0) {
                        var date = new Date(gi[0].startTime);
                        var execDuration = (gi[0].executionDuration / 1000) + 's'
                        evidenceSources[i].startTime(date.toLocaleDateString() + ' ' + date.toLocaleTimeString());
                        evidenceSources[i].executionDuration(execDuration);
                        evidenceSources[i].status(gi[0].status);
                        evidenceSources[i].isValid(gi[0].isValid);

                        if (gi[0].status == "RUNNING") {
                            self.pollForInfo();
                        }
                    }
                });
                self.evidenceSources(evidenceSources);
                self.loadingEvidenceSources(false);
            });
        };

        self.resultSources = ko.computed(function () {
            var resultSources = [];
            $.each(config.services, function (sourceIndex, service) {
                console.log(service);
                $.each(service.sources, function (i, source) {
                    if (source.hasResults) {
                        resultSources.push(source);
                        if (source.resultsUrl == self.defaultResultsUrl()) {
                            self.currentResultSource(source);
                        }
                    }
                })
            });

            return resultSources;
        }, this);

        self.loadResults = function (service) {
            self.loadingResults(true);
            self.currentEvidenceService(service);
            evidenceAPI.getNegativeControls(service.sourceKey(), self.conceptSet().id).then(function (results) {
                console.log("Get negative controls");
                var conceptIdsForNegativeControls = $.map(results, function (o, n) {
                    return o.conceptId;
                });
                cdmResultsAPI.getConceptRecordCount(self.currentResultSource().sourceKey, conceptIdsForNegativeControls, results).then(function (rowcounts) {
                    self.negativeControls(results);
                    self.loadingResults(false);
                });
            });
        }

        // Evalute the concept set when this component is loaded
        self.evaluateConceptSet();

        // Get the evidence sources
        self.getEvidenceSources();
    }

    var component = {
        viewModel: negativeControls,
        template: view
    };

    ko.components.register('negative-controls', component);
    return component;
});