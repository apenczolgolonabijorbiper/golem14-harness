# Work item observations

The host maps its verified producer fields to this observation kind. Check scope
before resolving an item or relation target. Keep raw reference names alongside
any normalized producer values.

| Work item evidence | Proposed predicate and direction |
| --- | --- |
| System.LinkTypes.Hierarchy-Forward (Child) | current item parent_of target |
| System.LinkTypes.Hierarchy-Reverse (Parent) | target parent_of current item |
| System.LinkTypes.Dependency-Forward (Successor) | current item precedes target |
| System.LinkTypes.Dependency-Reverse (Predecessor) | target precedes current item |
| System.State | current item has_state exact state |
| System.WorkItemType | current item has_work_item_type exact type |
| System.AssignedTo | current item assigned_to evidenced identity |

Unknown or custom relations require an owner-reviewed mapping. Leave unresolved
targets unresolved. A missing or unexpanded field or relation does not establish
removal. Use explicit producer revision or interval evidence for history.
